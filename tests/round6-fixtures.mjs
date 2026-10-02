// 第六輪（W2）測試共用：在 W1 的真實內容尚未就位時，合成「國際合作」區塊與「72 份推導清單」。
// 不以 .test.mjs 結尾，不會被 node --test 直接執行。真實內容已存在時（topic.international-cooperation、清單數 ≥ 72），測試優先用真實資料。
import { mk, addItem, govern } from './helpers.mjs';

const REV = { reviewer: '內部英文審核人', reviewedAt: '2026-09-30' };
const EN_ZH = (zh) => ({ 'zh-TW': { status: 'reviewed', ...REV }, en: { status: 'source' }, ja: { status: 'none' }, tl: { status: 'none' }, vi: { status: 'none' }, id: { status: 'none' }, th: { status: 'none' } })[zh] ?? zh;
void EN_ZH;

const BI_EN = `Bilateral memoranda and cooperation arrangements.

| Country / agency | Cooperation topics | Year signed | Status |
| --- | --- | --- | --- |
| United States — AIT / TECRO | Laboratory capacity; emerging infections | 2019 | Active |
| Japan — National Institute of Infectious Diseases | Surveillance and FETP exchange | 2018 | Active |
| Philippines — Department of Health | TB control | 2021 | Under negotiation |
| Thailand — Ministry of Public Health | Dengue control | 2015 | Expired |
| European Union — ECDC | Information exchange | 2022 | Active |
`;
const BI_ZH = `雙邊備忘錄與合作安排。

| 國家／機構 | 合作主題 | 簽署年 | 狀態 |
| --- | --- | --- | --- |
| 美國 — AIT／TECRO | 實驗室能力；新興傳染病 | 2019 | 合作中 |
| 日本 — 國立感染症研究所 | 監測與 FETP 交流 | 2018 | 合作中 |
| 菲律賓 — 衛生部 | 結核病防治 | 2021 | 洽簽中 |
| 泰國 — 公共衛生部 | 登革熱防治 | 2015 | 已屆期 |
| 歐盟 — ECDC | 資訊交換 | 2022 | 合作中 |
`;

const PAGES = [
  ['ihr-focal-point', 'IHR National Focal Point', 'IHR 國家窗口', 'Taiwan CDC serves as the IHR (2005) National Focal Point, reachable around the clock. Phone: +886-2-2395-9825; email: ihr@example.gov.tw. Open 24/7 for event notification.', '疾管署為國際衛生條例（2005）國家窗口，全年無休。電話：+886-2-2395-9825；信箱：ihr@example.gov.tw。24 小時受理事件通報。'],
  ['multilateral', 'Multilateral cooperation', '多邊合作', 'Participation in WHO technical meetings, APEC and GHSA.', '參與 WHO 技術會議、APEC 與全球衛生安全議程。', '- **WHA technical meetings** — observer participation in technical sessions.\n- **APEC Health Working Group** — regional preparedness.\n- **GHSA** — Global Health Security Agenda action packages.\n'],
  ['bilateral', 'Bilateral cooperation and MOUs', '雙邊合作與備忘錄', 'MOUs and cooperation with partner countries and regions.', '與夥伴國家與地區的 MOU 與合作。', BI_EN, BI_ZH],
  ['training', 'International training', '國際訓練', 'FETP, laboratory and TB-DOTS training for foreign health officials.', '提供外國衛生人員 FETP、實驗室與都治訓練。'],
  ['global-health-security', 'Global health security', '全球衛生安全', 'AMR, vaccines and border quarantine cooperation.', '抗藥性、疫苗與邊境檢疫合作。'],
  ['publications-en', 'English publications', '英文出版品', 'Taiwan Epidemiology Bulletin and annual reports.', '英文疫情報導與年報。'],
];

/** 把國際合作區塊加進 site（要在 applyGovernance 之前：用 govern(today, (s) => addIntl(s))） */
export function addIntl(site) {
  const base = (id, extra) => ({
    id, owner: 'unit.international', sourceLang: 'en', publishedAt: '2026-09-20', reviewedAt: '2026-09-30', reviewPeriodMonths: 12, audience: ['public', 'professional'],
    languages: { en: { status: 'source' }, 'zh-TW': { status: 'reviewed', ...REV }, ja: { status: 'none' } }, ...extra,
  });
  if (!site.unitById.has('unit.international')) {
    const u = { id: 'unit.international', name: '國際合作組', nameEn: 'Division of International Cooperation', kind: 'division' };
    site.master.units.push(u); site.unitById.set(u.id, u);
  }
  const pageIds = [];
  for (const [key, en, zh, sumEn, sumZh, bodyEn, bodyZh] of PAGES) {
    const body = bodyEn ?? `${sumEn}\n\n- **Item one** — details.\n`;
    const item = mk(base(`page.international-${key}`, {
      type: 'page', slug: `international/${key}`, title: en, summary: sumEn, bodyMarkdown: body,
      i18n: { 'zh-TW': { title: zh, summary: sumZh, bodyMarkdown: bodyZh ?? `${sumZh}\n\n- **項目一** — 說明。\n` } },
    }));
    addItem(site, item);
    pageIds.push(item.id);
  }
  const svc = mk(base('service.international-training-application', {
    type: 'service', slug: 'international-training-application', title: 'Apply for Taiwan CDC international training', summary: 'Foreign health officials can apply for FETP and laboratory training.',
    whoCanApply: ['Foreign health officials'], steps: [{ title: 'Submit the application form', text: 'x', days: 0 }, { title: 'Review', text: 'y', days: 10 }, { title: 'Notification', text: 'z', days: 5 }], slaDays: 15,
    contact: 'Division of International Cooperation, intl@example.gov.tw',
    i18n: { 'zh-TW': { title: '外國衛生人員國際訓練申請', summary: '外國衛生人員可申請 FETP 與實驗室訓練。', whoCanApply: ['外國衛生人員'], steps: [{ title: '送出申請表' }, { title: '審查' }, { title: '通知' }] } },
  }));
  addItem(site, svc);
  const newsIds = [];
  for (const [slug, en, zh] of [['mou-signing', 'Taiwan CDC signs health MOU', '疾管署簽署衛生合作備忘錄'], ['fetp-workshop', 'FETP workshop opens', '研習營開訓'], ['wha-technical', 'Taiwan CDC joins WHA technical meeting', '疾管署參與 WHA 技術會議']]) {
    const n = mk(base(`news.${slug}`, { type: 'news', title: en, summary: en, newsType: 'press', bodyMarkdown: `${en}.`, reviewPeriodMonths: 0, i18n: { 'zh-TW': { title: zh, summary: zh, bodyMarkdown: `${zh}。` } } }));
    addItem(site, n);
    newsIds.push(n.id);
  }
  const tp = mk(base(INTL_TOPIC, {
    type: 'topic', slug: 'international-cooperation', kind: 'program', title: 'International Cooperation', summary: 'How Taiwan CDC works with WHO and partner countries.',
    introMarkdown: 'Taiwan CDC cooperates with WHO and partners worldwide.',
    links: PAGES.map(([key, en]) => ({ label: en, href: `/international/${key}/` })), contentIds: [...pageIds, svc.id, ...newsIds],
    sections: pageIds,
    i18n: { 'zh-TW': { title: '國際合作', summary: '疾管署與 WHO 及夥伴國家的合作。', introMarkdown: '疾管署與 WHO 及各國夥伴合作。' } },
  }));
  addItem(site, tp);
  return site;
}
export const INTL_TOPIC = 'topic.international-cooperation';

/** 合成「每種疾病一份清單」的 site.migration（規模化後的形狀；W1 的真實資料就位且 ≥ 72 份時不需要） */
export function scaleMigration(site, { n = 72 } = {}) {
  const diseases = (site.master?.diseases ?? []).slice(0, n);
  const tpl = [
    ['intro', '疾病介紹', 'disease-block', 'symptoms'], ['prevention', '預防方法', 'disease-block', 'prevention'], ['vaccine', '預防接種建議', 'related', null],
    ['qa', 'Q&A', 'related', null], ['edu', '衛教宣導', 'related', null], ['guide', '法規與指引', 'related', null], ['stat', '統計資料', 'related', null],
    ['lab', '檢驗資訊', 'related', null], ['report', '通報定義', 'master-field', null], ['news', '新聞稿列表', 'related', null],
  ];
  const lists = diseases.map((d, di) => {
    const hasPage = site.collections.diseases.some((p) => p.id === d.id && p.status === 'published');
    const curated = hasPage && di % 5 === 0;
    const items = tpl.map(([key, oldTitle, kind, block], i) => {
      let status = 'pending', target = null;
      if (hasPage && (kind === 'disease-block' || i % 3 === 0)) { status = kind === 'disease-block' ? 'merged' : 'migrated'; target = d.id; }
      return { key, oldTitle, oldPath: `${d.name}／${oldTitle}`, oldUrl: `https://www.cdc.gov.tw/Disease/SubIndex/{id}#${key}`, oldType: 'page', verified: false, status, target, ...(block && target ? { anchor: block } : {}), note: target ? `併入疾病頁「${oldTitle}」` : '新站尚無對應內容', newRequirements: ['owner', 'reviewedAt'], listId: `migration.${d.slug}`, derived: !curated };
    });
    return {
      id: `migration.${d.slug}`, type: 'migration', title: `${d.name}專區（舊站）→ 新站`, owner: d.owner ?? 'unit.acute-infectious', scope: { kind: 'disease', disease: d.id },
      slug: d.slug, derived: !curated, hasPage, disease: d.id, legalCategory: d.legalCategory, status: hasPage ? 'published' : 'no-page', legacyRoot: 'https://www.cdc.gov.tw/Disease/SubIndex/{id}', showLegacyUntil: '2027-12-31', items,
    };
  });
  const count = (k) => lists.reduce((a, l) => a + l.items.filter((i) => i.status === k).length, 0);
  site.migration = {
    ...(site.migration ?? {}), lists, byTarget: new Map(), byDisease: new Map(lists.map((l) => [l.disease, l])),
    stats: { lists: lists.length, derived: lists.filter((l) => l.derived).length, curated: lists.filter((l) => !l.derived).length, noPage: lists.filter((l) => !l.hasPage).length, migrated: count('migrated'), merged: count('merged'), archived: 0, pending: count('pending'), dropped: 0, verified: 0, total: lists.reduce((a, l) => a + l.items.length, 0) },
    pending: lists.flatMap((l) => l.items.filter((i) => i.status === 'pending')),
  };
  return site;
}

export { govern };
