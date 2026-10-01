// 治理規則測試（骨架；Agent A 擴充每條規則）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';

function build(today = '2026-10-01') { const site = loadSite(config); site.today = today; assert.deepEqual(validateSite(site), []); applyGovernance(site); return site; }

test('schema 與參照檢查全部通過', () => { build(); });

test('MMR 108.5.14 版自動標為失效、退出白名單、指向現行版', () => {
  const site = build();
  const old = site.byId.get('doc.mmr-recommendation.2019-05-14');
  const cur = site.byId.get('doc.mmr-recommendation.2025-04-16');
  assert.equal(old.isCurrent, false); assert.equal(old.supersededBy, cur.id); assert.equal(cur.isCurrent, true);
  assert.equal(old.gov.whitelist.effective, false); assert.ok(old.gov.whitelist.reasons.includes('superseded'));
  assert.ok(old.gov.annotations.some((a) => a.kind === 'superseded'));
});

test('2025-01-09 新聞稿依據的正本已修訂 → 自動加註、退出白名單、產生 7 日待辦', () => {
  const site = build();
  const n = site.byId.get('news.2025-01-09-mmr-adults-measles');
  assert.equal(n.gov.stale.length, 1); assert.equal(n.gov.stale[0].revisedAt, '2025-04-16');
  assert.equal(n.gov.whitelist.effective, false);
  assert.ok(site.gov.todos.some((t) => t.kind === 'based-on-revised' && t.itemId === n.id && t.dueAt === '2025-04-23'));
});

test('反向稽核：麻疹主題內容出現「1981 年以後出生」即命中', () => {
  const site = build();
  const n = site.byId.get('news.2025-01-09-mmr-adults-measles');
  assert.ok(n.gov.reverseAuditHits.length >= 1);
  const faq = site.byId.get('faq.measles-mmr-adult-who');
  assert.equal(faq.gov.reverseAuditHits.length, 0, '新 FAQ 提到「1981 年的舊分界已不再適用」不含失效條件原句');
});

test('逾期未審閱 → 退出白名單；時間前進會讓內容逾期', () => {
  const ok = build('2026-10-01'); assert.equal(ok.byId.get('disease.dengue').gov.overdue, false);
  const late = build('2027-08-01'); assert.equal(late.byId.get('disease.dengue').gov.overdue, true); assert.equal(late.byId.get('disease.dengue').gov.whitelist.effective, false);
});

test('Banner 到期自動下架（不出現在 v1/banners）', () => {
  const site = build('2026-12-15');
  const b = site.collections.banners.find((x) => x.id === 'banner.2026-flu-vaccine');
  assert.ok(b.endAt < site.today);
});
