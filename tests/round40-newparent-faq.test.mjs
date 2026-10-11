// 第四十輪（issue #77）：新手爸媽 4 則 FAQ（補接種、未滿 6 個月與流感疫苗、懷孕／哺乳接種、嬰兒 RSV 預防）。
// 治理：一律 verification: pending、權責 unit.preventive-medicine、來源標「官方但未逐字核對」；
// 內容保守：不得出現肯定式的危險建議（未滿 6 個月可以打流感疫苗、孕期可打活性減毒疫苗、自行補打、RSV 一定公費……）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';

const FAQS = {
  'faq.catch-up-vaccination': 'content/faq/catch-up-vaccination.json',
  'faq.infant-flu-under-6-months': 'content/faq/infant-flu-under-6-months.json',
  'faq.pregnancy-breastfeeding-vaccination': 'content/faq/pregnancy-breastfeeding-vaccination.json',
  'faq.infant-rsv-prevention': 'content/faq/infant-rsv-prevention.json',
};
const SOURCE_URL = 'https://www.cdc.gov.tw/Category/List/_MJYeQXoPjzYik1sYwTj6Q';
// 肯定式危險說法：出現在 FAQ 內文或答案句就是錯（題目本身的問句「要從頭重打嗎？」不算，所以只比對內文與摘要）
const DANGER = [
  /必須從頭重打|需要從頭重打|要從頭重打[。，]/,
  /未滿\s*6\s*個月(的嬰兒)?(就|也)?可以(打|接種)/,
  /懷孕期間(可以|也可)(接種|打)\s*(MMR|麻疹|水痘|活性減毒)/,
  /(?<!不要|請勿|避免|切勿)自行(補打|調整劑次|決定)/, // 「不要自行調整」是正確的提醒，排除否定
  /不(需要|用|必)(就醫|看醫生|告知醫師)/,
  /RSV[^。]{0,12}(一律|一定|全面)公費/,
  /保證(有效|安全|不會)/,
];

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

let ENGINE = null;
function engine() {
  if (ENGINE) return ENGINE;
  const site = loadSite(config);
  site.today = '2026-10-11';
  applyGovernance(site);
  site.searchIndex = buildSearchIndex(site);
  applyConsistency(site);
  return (ENGINE = engineFromSite(site));
}

test('4 則 FAQ：verification pending、權責預防醫學辦公室、來源為官方但未核對', () => {
  for (const [id, p] of Object.entries(FAQS)) {
    const f = read(p);
    assert.equal(f.id, id);
    assert.equal(f.type, 'faq');
    assert.equal(f.owner, 'unit.preventive-medicine', id);
    assert.equal(f.verification?.status, 'pending', id);
    assert.ok(f.verification.pendingItems?.length >= 2, `${id} 要列出待補項目`);
    const src = f.verification.sources?.find((s) => s.url === SOURCE_URL);
    assert.ok(src, `${id} 來源網址`);
    assert.equal(src.official, true);
    assert.equal(src.verified, false, `${id} 來源未逐字核對，不得標 verified`);
    // 只有中文原文，其他語言 none（不得假裝有譯文）
    assert.equal(f.languages['zh-TW'].status, 'source');
    for (const [lg, v] of Object.entries(f.languages)) if (lg !== 'zh-TW') assert.equal(v.status, 'none', `${id}.${lg}`);
  }
});

test('FAQ 內文與摘要沒有肯定式危險建議', () => {
  for (const [id, p] of Object.entries(FAQS)) {
    const f = read(p);
    for (const field of ['answerMarkdown', 'summary']) for (const re of DANGER) assert.doesNotMatch(f[field], re, `${id}.${field} ${re}`);
  }
  // 關鍵的保守說法要在
  assert.match(read(FAQS['faq.infant-flu-under-6-months']).answerMarkdown, /出生滿 6 個月\*\*才能接種/);
  assert.match(read(FAQS['faq.pregnancy-breastfeeding-vaccination']).answerMarkdown, /活性減毒疫苗，懷孕期間不建議接種/);
  assert.match(read(FAQS['faq.infant-rsv-prevention']).answerMarkdown, /依現行政策/);
});

test('五個新手爸媽問句引用對應 FAQ，答案句沒有危險說法', () => {
  const cases = [
    ['寶寶疫苗漏打了怎麼辦', 'faq.catch-up-vaccination'],
    ['錯過接種時間要補打嗎', 'faq.catch-up-vaccination'],
    ['6 個月以下的嬰兒可以打流感疫苗嗎', 'faq.infant-flu-under-6-months'],
    ['嬰兒怎麼預防 RSV', 'faq.infant-rsv-prevention'],
    ['哺乳期間可以打疫苗嗎', 'faq.pregnancy-breastfeeding-vaccination'],
  ];
  for (const [q, id] of cases) {
    const r = engine().answer(q, { lang: 'zh-TW' });
    assert.equal(r.refused, false, q);
    assert.ok(
      r.sources.some((s) => s.contentId === id),
      `${q} → ${id}，實際 ${r.sources.map((s) => s.contentId)}`,
    );
    const txt = r.sentences.map((s) => s.text).join(' ');
    for (const re of DANGER) assert.doesNotMatch(txt, re, `${q} ${re}`);
  }
});

test('評估集收錄五題且要求引用這些 FAQ', () => {
  const set = read('content/governance/eval-set.json');
  const np = set.questions.filter((x) => x.id.startsWith('NP'));
  assert.equal(np.length, 5);
  for (const x of np)
    assert.ok(
      x.expect.mustCite.some((m) => m in FAQS),
      x.id,
    );
});
