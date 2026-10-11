// 第四十輪（issue #75、#78）：答案引擎的服務意圖、逐字稿旁白、謠言原文不引用、最低資訊量、外語「先對應主題再檢索」與「在哪裡打」。
// 用真實內容建索引（與 build.mjs 同順序），斷言的是民眾看得到的行為（引用來源、句子、行動），不綁內部分數。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex, stripSpeaker, quotesClaim } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { SERVICE_CUE, VAX_WHERE_RE, classifyIntent } from '../src/client/answer/rules.js';
import { topicAnchorsOf } from '../src/client/answer/lexicon.js';
import { CATCHUP_RE } from '../src/client/answer/core.js';

let SITE = null;
let ENGINE = null;
function site() {
  if (SITE) return SITE;
  SITE = loadSite(config);
  SITE.today = '2026-10-11';
  applyGovernance(SITE);
  SITE.searchIndex = buildSearchIndex(SITE);
  applyConsistency(SITE);
  return SITE;
}
function engine() {
  return (ENGINE ??= engineFromSite(site()));
}
const ask = (q, lang = 'zh-TW') => engine().answer(q, { lang });
const cites = (r) => (r.sources ?? []).map((s) => s.contentId);
const text = (r) => (r.sentences ?? []).map((s) => s.text).join(' ');

// ───────── #78 服務意圖 ─────────
test('服務意圖：怎麼查／在哪裡／去哪裡申請／where can I get 命中；「怎麼辦」「哪裡打疫苗」不算', () => {
  for (const q of [
    '怎麼查小孩的預防接種紀錄',
    '兒童健康手冊在哪裡',
    '黃皮書去哪裡申請',
    '如何申請國際預防接種證明書',
    'Where can I get my vaccination record?',
    'How do I get a yellow card?',
  ])
    assert.ok(SERVICE_CUE.test(q), q);
  for (const q of ['被狗咬怎麼辦', '發燒了怎麼辦', '登革熱有哪些症狀']) assert.ok(!SERVICE_CUE.test(q), q);
  // 問「在哪裡打疫苗」是接種地點（vaxmap／衛生所），不是申請服務
  for (const q of ['流感疫苗去哪裡打', 'Where can I get a flu vaccine?']) assert.ok(VAX_WHERE_RE.test(q), q);
  assert.equal(classifyIntent('怎麼查小孩的預防接種紀錄').intent, 'apply');
});

test('「怎麼查」「在哪裡」優先給服務步驟，不引用結核病專區', () => {
  for (const q of ['怎麼查小孩的預防接種紀錄', '兒童健康手冊在哪裡']) {
    const r = ask(q);
    assert.equal(r.refused, false, q);
    assert.equal(cites(r)[0], 'service.vaccination-record-reissue', q);
    assert.ok(!cites(r).some((c) => c.startsWith('topic.tb-prevention')), q);
    assert.ok(
      (r.actions ?? []).some((a) => String(a.href).includes('/apply/vaccination-record-reissue/')),
      q,
    );
  }
});

test('服務名稱與問句不相干時不硬塞申請步驟（外籍勞工健檢不會變成結核病補助申請）', () => {
  const r = ask('外籍勞工健康檢查與健保怎麼辦理');
  assert.ok(cites(r).includes('faq.tb-foreigner-health-check'));
  assert.doesNotMatch(text(r), /第 1 步/);
});

// ───────── #78 逐字稿旁白、謠言原文 ─────────
test('逐字稿：去掉「旁白：」「字幕：」前綴，chunk 標 role: narration', () => {
  assert.equal(stripSpeaker('旁白：入境後三日內要做健康檢查。'), '入境後三日內要做健康檢查。');
  assert.equal(stripSpeaker('Narrator: Wash your hands.'), 'Wash your hands.');
  assert.equal(stripSpeaker('醫師：請多喝水。'), '醫師：請多喝水。', '不是旁白／字幕的說話者照留');
  const media = site().searchIndex.public.filter((c) => c.type === 'media' && c.role === 'narration');
  assert.ok(media.length > 0);
  for (const c of media) for (const s of c.sentences ?? []) assert.doesNotMatch(s, /^(旁白|字幕)[:：]/, c.id);
});

test('澄清稿引述的謠言原文記在 noCite，一般問句不會把謠言當答案句', () => {
  const claim = '打流感疫苗反而會得流感，長輩打完會死，不要讓爸媽去打';
  assert.equal(quotesClaim('針對社群流傳「打流感疫苗反而會得流感，長輩打完會死」的訊息，疾病管制署澄清，此說法並非事實。', [claim]), true);
  assert.equal(quotesClaim('公費流感疫苗為不活化疫苗，不含活病毒，不會因接種而得到流感。', [claim]), false);
  const news = site().searchIndex.public.find((c) => c.id.startsWith('news.2026-09-10-clarify-flu-vaccine-death') && (c.noCite ?? []).length);
  assert.ok(news, '澄清新聞稿的謠言句應標 noCite');
  const r = ask('懷孕可以打流感疫苗嗎');
  assert.equal(r.refused, false);
  assert.doesNotMatch(text(r), /長輩打完會死|旁白|字幕/);
});

// ───────── #75 最低資訊量、外語主題對應、where ─────────
test('資訊量太少的短句（They should check.）不會被抽出', () => {
  const r = ask('I am a migrant worker, where do I do my health check?', 'en');
  assert.equal(r.refused, false);
  // 合併來臺專區後：英文來源的來臺專區移工段（同語言）與中文移工健檢 FAQ 都算對，但第一句必須真的回答健檢時點
  const ok = ['faq.tb-foreigner-health-check', 'media.migrant-worker-health-check', 'topic.new-residents-migrant-health', 'topic.visiting-taiwan'];
  assert.ok(
    cites(r).some((c) => ok.includes(c)),
    cites(r).join(','),
  );
  assert.match(r.sentences[0].text, /3 working days|3 個工作日/);
  assert.doesNotMatch(text(r), /They should check\./);
  for (const s of r.sentences) assert.ok(s.text.split(/\s+/).length >= 4 || /[㐀-鿿]/.test(s.text), s.text);
});

test('外語主題錨點：移工、健保、接種紀錄、來臺旅遊各自對應到中文主題詞', () => {
  const zhOf = (q) => topicAnchorsOf(q).flatMap((a) => a.zh);
  assert.ok(zhOf('How do migrant workers get health checks?').includes('移工'));
  assert.ok(zhOf('Bagaimana pekerja migran mengurus asuransi kesehatan?').includes('健保'));
  assert.ok(zhOf('I am visiting Taiwan next month').some((z) => z.includes('來臺')));
  assert.deepEqual(topicAnchorsOf('What are the symptoms of dengue?'), []);
});

test('來臺問句：主題錨點命中英文來源的來臺專區（標題就在講這個主題 ⇒ 不因用詞相關度偏低而查無），不拿出國旅遊建議充數', () => {
  for (const q of ['I am visiting Taiwan next month, what should I do?', 'I am visiting Taiwan next month, what precautions?']) {
    const r = ask(q, 'en');
    assert.equal(r.refused, false, q);
    assert.equal(cites(r)[0], 'topic.visiting-taiwan', q);
    assert.ok(!cites(r).some((c) => c.startsWith('travel.')), q);
  }
  // 沒有錨點的無關外語問句仍查無
  assert.equal(ask('How do I repair a quantum computer cooling system?', 'en').refusal?.kind, 'no-match');
});

test('「在哪裡打疫苗」：接種地點句排第一、查詢接種地點行動排第一', () => {
  const r = ask('Where can I get a flu vaccine?', 'en');
  assert.equal(r.refused, false);
  assert.match(r.sentences[0].text, /health cent|clinic/i);
  assert.match(String(r.actions[0].href), /vaxmap/);
  const zh = ask('流感疫苗去哪裡打');
  assert.match(zh.sentences[0].text, /合約院所|衛生所/);
});

test('只問「這則訊息是真的嗎」沒貼內容：七語都拒答為 no-clarification，導向澄清專區', () => {
  const qs = {
    'zh-TW': '這則訊息是真的嗎',
    en: 'Is this message true?',
    ja: 'このメッセージは本当ですか',
    vi: 'Tin nhắn này có thật không?',
    tl: 'Totoo ba ang mensaheng ito?',
    id: 'Apakah pesan ini benar?',
    th: 'ข้อความนี้จริงหรือไม่',
  };
  for (const [lang, q] of Object.entries(qs)) {
    const r = ask(q, lang);
    assert.equal(r.refusal?.kind, 'no-clarification', `${lang} ${q}`);
    assert.ok(
      r.refusal.actions.some((a) => a.href === '/factcheck/'),
      lang,
    );
  }
});

// ───────── #77 補接種問句不走年齡時程表 ─────────
test('補接種問句（漏打、錯過、補打）不走年齡時程表', () => {
  for (const q of ['寶寶疫苗漏打了怎麼辦', '錯過接種時間要補打嗎', '忘記打第二劑怎麼辦']) assert.ok(CATCHUP_RE.test(q), q);
  assert.ok(!CATCHUP_RE.test('65 歲今年打什麼公費疫苗'));
  const r = ask('寶寶疫苗漏打了怎麼辦');
  assert.ok(!cites(r).includes('master.immunization-schedule'));
  assert.ok(r.intentReasons.includes('vac.catch-up'));
});
