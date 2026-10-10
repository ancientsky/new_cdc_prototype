// 第二十五輪（Issue #37）：新聞稿相對日期規則——驗證警告／錯誤、答案單元加發布日標註、既有內容全數通過。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { relativeDateFindings, contentWarnings, validateSite } from '../scripts/lib/validate.mjs';
import { hasRelativeDate, tagRelativeDate } from '../scripts/lib/dates.mjs';

const news = (over) => ({ type: 'news', title: '標題', summary: '摘要', bodyMarkdown: '首段。\n\n第二段說今年很多。', __file: 'content/news/x.json', ...over });

test('相對日期：同句沒有絕對日期才算（今（N）日／今年／上週…）', () => {
  assert.equal(hasRelativeDate('疾病管制署今（21）日公布'), true);
  assert.equal(hasRelativeDate('疾病管制署於 2026 年 7 月 21 日（今日）公布'), false);
  assert.equal(hasRelativeDate('今年首例'), true);
  assert.equal(hasRelativeDate('2026 年（今年）首例'), false);
  assert.equal(hasRelativeDate('上週類流感就診率上升'), true);
  assert.equal(hasRelativeDate('2026-09-29 發布，上週類流感上升'), false);
  assert.equal(hasRelativeDate('114 年度公費流感疫苗今日開打'), true, '民國年度不算絕對日期');
  assert.equal(hasRelativeDate('昨日、明（3）日、本週、去年'), true);
});

test('只檢查標題、摘要與首段；第二段以後不管；不是 news／letter／clarification 的型別不管', () => {
  assert.equal(relativeDateFindings(news({})).length, 0, '第二段的「今年」不查');
  const f = relativeDateFindings(news({ title: '今日開打', bodyMarkdown: '## 小標\n\n疾管署今（9）日公布。' }));
  assert.deepEqual(f.map((x) => x.field), ['title', '首段']);
  assert.equal(relativeDateFindings({ type: 'faq', title: '今日', bodyMarkdown: '今日' }).length, 0);
  assert.equal(relativeDateFindings(news({ type: 'letter', title: '本週通函' })).length, 1);
});

test('news／letter 為警告（contentWarnings）；clarification 為錯誤（validateSite）', () => {
  const site = { all: [news({ title: '今日公布' }), { ...news({ title: '今年澄清' }), type: 'clarification', clarificationMarkdown: '去年的說法不實。' }] };
  const w = contentWarnings(site);
  assert.equal(w.length, 1); assert.match(w[0], /content\/news\/x\.json/); assert.match(w[0], /guide-staff/);
  const real = loadSite(config);
  const errs = validateSite({ ...real, all: [...real.all, { ...site.all[1], id: 'clar.fake' }] }).filter((e) => e.includes('相對日期'));
  assert.ok(errs.length >= 1, '澄清稿的相對日期是錯誤');
});

test('現有內容：沒有任何新聞稿、通函、澄清稿還帶著未標絕對日期的相對日期', () => {
  const real = loadSite(config);
  assert.deepEqual(contentWarnings(real), []);
  assert.deepEqual(validateSite(real).filter((e) => e.includes('相對日期')), []);
});

test('答案單元：仍含相對日期的句子加〔YYYY-MM-DD 發布〕前綴；已有絕對日期或無相對日期的不動', () => {
  assert.equal(tagRelativeDate('今年首例本土病例。', '2026-07-21'), '〔2026-07-21 發布〕今年首例本土病例。');
  assert.equal(tagRelativeDate('2026 年（今年）首例。', '2026-07-21'), '2026 年（今年）首例。');
  assert.equal(tagRelativeDate('請清除積水容器。', '2026-07-21'), '請清除積水容器。');
  assert.equal(tagRelativeDate('今年首例。', undefined), '今年首例。');
  assert.equal(tagRelativeDate('〔2026-07-21 發布〕今年首例。', '2026-07-21'), '〔2026-07-21 發布〕今年首例。');
});
