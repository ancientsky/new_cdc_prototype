// 第三十三輪：跨內容說法不一致、歷史新聞稿（ARCHITECTURE §39、決策紀錄 §26、guide-staff §37）。
// Yulun 2026-10-10 問：資料治理還沒辦法很全面時，不同組室上架類似答案、或新聞稿有新舊不同的政策建議，要怎麼確保使用者拿到最正確的資訊。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency, conflictBetween, preferredOf, authorityOf } from '../scripts/lib/consistency.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { numbersByUnit } from '../src/client/answer/core.js';
import { groundingGuard } from '../src/client/answer/llm.js';
import { pagefindFor } from '../src/templates/public/_pagefind.mjs';

function build({ today = '2026-10-10', decisions = null } = {}) {
  const s = loadSite(config);
  s.today = today;
  if (decisions) s.governance.consistency = { version: 1, decisions };
  applyGovernance(s);
  s.searchIndex = buildSearchIndex(s);
  applyConsistency(s);
  return s;
}
let SITE = null;
const site = () => (SITE ??= build());

test('numbersByUnit：完整日期不算建議數字；範圍記成 2-4；周→週、日→天', () => {
  const m = numbersByUnit('依 2025 年 4 月 16 日修訂，建議出國前 2 至 4 周評估接種 1 劑，10 日內完成');
  assert.deepEqual([...m.get('週')], ['2-4']);
  assert.deepEqual([...m.get('劑')], ['1']);
  assert.deepEqual([...m.get('天')], ['10']);
  assert.equal(m.has('年'), false);
});

test('conflictBetween：同一件事、同單位數字不同才算；數字相同、短句比長句、只差日期都不算', () => {
  assert.deepEqual(conflictBetween('接種後請在現場留觀 15 分鐘。', '旁白：接種後請在現場休息觀察至少 30 分鐘。')?.unit, '分鐘');
  assert.equal(conflictBetween('接種後請在現場留觀 30 分鐘。', '接種後請在現場休息觀察 30 分鐘。'), null);
  assert.equal(conflictBetween('麻疹預防：接種 2 劑 MMR 疫苗。', '1966 年（含）以後出生、不具麻疹免疫力的成人，若計畫前往麻疹流行地區，建議出國前 2 至 4 週至旅遊醫學門診評估自費接種 1 劑 MMR 疫苗。'), null);
  assert.equal(conflictBetween('依 2025 年 4 月 16 日修訂的建議，出國前 2 至 4 週評估接種。', '依 2026 年 1 月 15 日修訂的建議，出國前 2 至 4 週評估接種。'), null);
});

test('preferredOf：較新且對方之後沒再審閱 ⇒ 較新者；否則權威順序（文件 > 疾病頁 > Q&A > 新聞稿 > 影音）；歷史新聞稿不靠「較新」勝出', () => {
  const faq = { type: 'faq', publishedAt: '2026-01-01', reviewedAt: '2026-01-01' };
  const media = { type: 'media', publishedAt: '2026-09-01', reviewedAt: '2026-09-01' };
  assert.deepEqual(preferredOf(faq, media), { prefer: 'b', reason: 'newer-than-other-review' });
  assert.equal(preferredOf({ ...faq, reviewedAt: '2026-09-15' }, media).prefer, 'a'); // Q&A 在影片之後重新審閱過 ⇒ 權威
  const doc = { type: 'document', effectiveAt: '2025-04-16', reviewedAt: '2026-05-01' };
  const oldNews = { type: 'news', publishedAt: '2026-04-01', reviewedAt: '2026-04-01', historical: true };
  assert.equal(preferredOf(doc, oldNews).prefer, 'a');
  assert.ok(authorityOf({ type: 'faq', responsible: true }) > authorityOf({ type: 'faq' }));
  assert.ok(authorityOf({ type: 'news', historical: true }) < authorityOf({ type: 'news' }));
});

test('applyConsistency（repo 內容）：流感留觀 15 vs 30 分鐘列為候選、兩邊單位各一則待辦；consistency.json 判定為非矛盾的組不再提出', () => {
  const s = site();
  const c = s.gov.consistency;
  assert.ok(c.sentencesCompared > 1000);
  const flu = c.list.find((x) => x.unit === '分鐘' && [x.a.contentId, x.b.contentId].includes('faq.influenza-vaccine-where'));
  assert.ok(flu, '應找出留觀時間不一致');
  assert.equal(flu.status, 'candidate');
  assert.ok(c.dismissed >= 2, 'TB 兩組已判定 not-conflict');
  assert.ok(!c.list.some((x) => [x.a.contentId, x.b.contentId].includes('doc.ltbi-guideline.2024-01-01') && x.unit === '劑'));
  const todos = s.gov.todos.filter((t) => t.kind === 'content-conflict' && t.conflictId === flu.id);
  assert.equal(todos.length, 2);
  assert.ok(todos.every((t) => t.kindLabel && t.ownerName && t.dueAt));
  assert.ok(s.gov.summary.todosByKind['content-conflict'] >= 2, '儀表板數字要含建置後段的待辦');
  // 兩邊答案單元都標了 conflicts
  const tagged = s.searchIndex.public.filter((x) => (x.conflicts ?? []).some((y) => y.id === flu.id));
  assert.ok(tagged.length >= 2);
});

test('confirmed 判定：錯的那句移出答案索引、開待修正待辦；頁面內容不動', () => {
  const s = build({ decisions: [{ a: 'faq.influenza-vaccine-where', b: 'media.ltc-flu-vaccine', unit: '分鐘', decision: 'confirmed', prefer: 'media.ltc-flu-vaccine', decidedBy: '測試', decidedAt: '2026-10-10' }] });
  const all = [...s.searchIndex.public, ...s.searchIndex.pro];
  assert.ok(!all.some((x) => x.contentId === 'faq.influenza-vaccine-where' && x.sentences.some((t) => t.includes('15 分鐘'))));
  assert.ok(all.some((x) => x.contentId === 'media.ltc-flu-vaccine' && x.sentences.some((t) => t.includes('30 分鐘'))));
  const fix = s.gov.todos.find((t) => t.kind === 'content-conflict-fix');
  assert.equal(fix.itemId, 'faq.influenza-vaccine-where');
  assert.equal(s.gov.consistency.confirmed, 1);
  assert.ok(String(s.byId.get('faq.influenza-vaccine-where').answerMarkdown).includes('15 分鐘'), '頁面內容由權責單位修，不由建置改');
});

test('validate：判定指到不存在的內容、confirmed 沒填 prefer ⇒ 錯誤', () => {
  const s = loadSite(config);
  s.governance.consistency = { version: 1, decisions: [
    { a: 'faq.nope', b: 'media.ltc-flu-vaccine', decision: 'not-conflict', decidedBy: 'x', decidedAt: '2026-10-10' },
    { a: 'faq.influenza-vaccine-where', b: 'media.ltc-flu-vaccine', decision: 'confirmed', decidedBy: 'x', decidedAt: '2026-10-10' },
  ] };
  const errors = validateSite(s);
  assert.ok(errors.some((e) => e.includes('faq.nope')));
  assert.ok(errors.some((e) => e.includes('prefer')));
});

test('歷史新聞稿：超過 12 個月的新聞稿加註「當時的資訊」並連到疾病頁；公告類不適用；答案單元標 historical', () => {
  const s = site();
  const n = s.byId.get('news.2025-02-18-dengue-imported-spring');
  assert.equal(n.gov.historical, true);
  const a = n.gov.annotations.find((x) => x.kind === 'historical');
  assert.match(a.text, /發布於 2025-02-18/);
  assert.equal(a.path, '/diseases/dengue/');
  assert.equal(n.gov.whitelist.reasons.includes('historical'), false, '不退出白名單');
  assert.equal(s.byId.get('news.2026-09-18-flu-vaccine-oct1').gov.historical, false);
  for (const it of s.all.filter((x) => x.type === 'news' && ['recruit', 'procurement', 'other'].includes(x.newsType))) assert.equal(it.gov.historical, false, it.id);
  assert.ok(s.searchIndex.public.some((c) => c.contentId === 'news.2025-02-18-dengue-imported-spring' && c.historical === true));
});

test('答案：兩句都在時優先者排前面並加註；問現行時程不拿去年的新聞稿；判定非矛盾的不加註', () => {
  const e = engineFromSite(site());
  const r = e.answer('打完流感疫苗要在現場觀察多久');
  assert.equal(r.conflicts?.length, 1);
  const c = r.conflicts[0];
  assert.equal(c.unit, '分鐘');
  const iPrefer = r.sentences.findIndex((x) => (c.prefer.values ?? []).some((v) => x.text.includes(`${v} 分鐘`)));
  const iOther = r.sentences.findIndex((x) => (c.other.values ?? []).some((v) => x.text.includes(`${v} 分鐘`)));
  assert.ok(iPrefer >= 0 && (iOther < 0 || iPrefer < iOther));
  assert.ok(r.guards.some((g) => g.kind === 'conflict-noted'));

  const r2 = e.answer('公費流感疫苗什麼時候開打');
  assert.ok(!r2.sources.some((x) => x.contentId === 'news.2025-10-01-flu-vaccine-start'));

  const r3 = e.answer('潛伏結核感染治療有哪些處方', { view: 'pro' });
  assert.equal(r3.conflicts, undefined);
});

test('LLM 後檢：用了「非優先」那份數字的句子刪掉；用優先者數字的保留', () => {
  const chunks = [{ id: 'a#1', title: 'A', sentences: ['接種後請在現場休息觀察至少 30 分鐘。'] }, { id: 'b#1', title: 'B', sentences: ['接種後請在現場留觀 15 分鐘。'] }];
  const conflicts = [{ unit: '分鐘', prefer: { values: ['30'] }, other: { values: ['15'] } }];
  const { kept, dropped } = groundingGuard([{ text: '接種後請在現場留觀 15 分鐘。', cite: ['b#1'] }, { text: '接種後請在現場休息觀察至少 30 分鐘。', cite: ['a#1'] }], chunks, { conflicts });
  assert.equal(kept.length, 1);
  assert.match(dropped[0].reason, /^conflict-nonpreferred/);
});

test('全文搜尋：歷史新聞稿與依據已修訂的頁標 currency，現行頁為 current', () => {
  const s = site();
  assert.equal(pagefindFor({ item: s.byId.get('news.2025-02-18-dengue-imported-spring') }).currency, 'historical');
  assert.equal(pagefindFor({ item: s.byId.get('news.2025-01-09-mmr-adults-measles') }).currency, 'revised');
  assert.equal(pagefindFor({ item: s.byId.get('news.2026-09-18-flu-vaccine-oct1') }).currency, 'current');
});
