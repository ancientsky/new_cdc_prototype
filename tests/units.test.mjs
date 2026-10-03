// 單位主檔：反映疾管署實際組織（預防接種為急性傳染病組業務、國際合作為企劃組業務、署長室不上架內容、
// 會上架內容的秘書室／政風室／預防醫學辦公室要在主檔）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { govern } from './helpers.mjs';

test('單位主檔：沒有預防接種組與國際合作組；有秘書室、政風室、預防醫學辦公室；署長室標記不上架', () => {
  const site = govern();
  const names = new Set(site.master.units.map((u) => u.name));
  for (const bad of ['預防接種組', '國際合作組']) assert.ok(!names.has(bad), `${bad} 不應存在`);
  for (const need of ['秘書室', '政風室', '預防醫學辦公室', '企劃組', '急性傳染病組']) assert.ok(names.has(need), `缺 ${need}`);
  assert.equal(site.unitById.get('unit.director')?.publishes, false);
});

test('沒有任何內容由不上架的單位（署長室）擁有；預防接種與國際合作內容分別屬急性傳染病組與企劃組', () => {
  const site = govern();
  const nonPublishing = new Set(site.master.units.filter((u) => u.publishes === false).map((u) => u.id));
  const bad = site.all.filter((i) => nonPublishing.has(i.owner)).map((i) => i.id);
  assert.deepEqual(bad, []);
  const ids = new Set(site.master.units.map((u) => u.id));
  assert.ok(!ids.has('unit.vaccine') && !ids.has('unit.international'));
  assert.equal(site.byId.get('vaccine.mmr')?.owner, 'unit.acute-infectious');
  assert.equal(site.byId.get('topic.international-cooperation')?.owner, 'unit.planning');
  assert.equal(site.byId.get('page.director-mailbox')?.owner, 'unit.secretariat');
});
