// 第二十五輪（Issue #27、#38）：制度性頁面（法令規章、政府資訊公開、資訊安全政策、著作權聲明）、頁尾連結、移轉清單、公開詞彙頁。
import test from 'node:test';
import assert from 'node:assert/strict';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { pathOf } from '../scripts/lib/governance.mjs';
import { PAGE_PATHS } from '../src/templates/public/_partials.mjs';
import * as glossary from '../src/templates/public/glossary.mjs';
import * as page from '../src/templates/public/page.mjs';
import { layout } from '../src/templates/layout.mjs';
import { t } from '../src/client/i18n.js';

const site = govern('2026-10-10');
const ctxOf = (lang = 'zh-TW', path = '/') => makeCtx(site, lang, { path, alternates: ['zh-TW', 'en'] });
const NEW = { legal: '/policy/legal/', foia: '/policy/foia/', 'security-policy': '/policy/security/', copyright: '/policy/copyright/' };

test('四個制度性頁面：存在、已發布、權責單位在主檔、路徑與 pathOf 一致、整份站台驗證零錯誤', () => {
  for (const [slug, p] of Object.entries(NEW)) {
    const item = site.byId.get(`page.${slug}`);
    assert.ok(item, slug); assert.equal(item.status, 'published'); assert.equal(item.type, 'page');
    assert.ok(site.unitById.has(item.owner), `${slug} owner`);
    assert.equal(PAGE_PATHS[slug], p); assert.equal(pathOf(item), p); assert.equal(page.standalonePath(item), p);
    assert.ok(item.i18n?.en?.bodyMarkdown && item.i18n.en.title, `${slug} 英文版`);
  }
  assert.deepEqual(validateSite(site), []);
});

test('頁面內容：法規代碼、FOIA 第 7 條九項、OGDL、示意稿標示', () => {
  const body = (s) => site.byId.get(`page.${s}`).bodyMarkdown;
  for (const code of ['L0050001', 'L0050003', 'L0050008']) assert.ok(body('legal').includes(`pcode=${code}`), code);
  assert.ok(body('legal').includes('待確認'));
  assert.equal((body('foia').match(/^\| [一二三四五六七八九]、/gm) ?? []).length, 9);
  assert.ok(body('foia').includes('待建置'));
  assert.ok(body('security-policy').includes('示意稿，待資訊室確認'));
  assert.ok(body('copyright').includes('OGDL 1.0'));
});

test('頁尾「關於與政策」欄有四個新連結，「開放資料與開發者」欄有詞彙表；七語字串都有英文', () => {
  const html = String(layout(ctxOf(), { body: '', item: null }) ?? '');
  for (const p of [...Object.values(NEW), '/glossary/']) assert.ok(html.includes(`href="${p}"`) || html.includes(`${p}"`), p);
  for (const k of ['footer.legal', 'footer.foia', 'footer.security', 'footer.copyright', 'footer.glossary', 'page.legal', 'page.foia', 'page.security-policy', 'page.copyright', 'glossary.title']) {
    assert.notEqual(t('en', k), k, k); assert.notEqual(t('en', k), t('zh-TW', k), `${k} 英文要有翻譯`);
  }
});

test('移轉清單：institutional 對到兩頁、legacy-services 四項（電子報、抗蛇毒血清、核心教材、進階搜尋）', () => {
  const inst = site.migrationLists.find((m) => m.id === 'migration.institutional');
  assert.deepEqual(inst.items.map((i) => i.target), ['page.legal', 'page.foia']);
  assert.ok(inst.items[0].oldUrl.endsWith('3UATgJ9_kkHimGdkBKskPA')); assert.ok(inst.items[1].oldUrl.endsWith('abYRVtgFiTeOpA1lsLeZWg'));
  const svc = site.migrationLists.find((m) => m.id === 'migration.legacy-services');
  assert.deepEqual(svc.items.map((i) => i.key), ['newsletter', 'antivenom', 'core-curriculum', 'advanced-search']);
  assert.ok(svc.items.find((i) => i.key === 'antivenom').oldUrl.endsWith('l_z6ZKErZJ063m6OV_8nXQ'));
  assert.ok(svc.items.find((i) => i.key === 'newsletter').note.includes('已決策'));
  assert.ok(svc.items.find((i) => i.key === 'antivenom').note.includes('必移轉'));
});

test('詞彙頁：依英文字母分組排序、全部詞條都在、別名與舊稱可搜尋、篩選框預設 hidden（沒有 JS 就是完整清單）', () => {
  const g = site.master.glossary;
  const groups = glossary.groupGlossary(g);
  assert.equal(groups.reduce((n, [, l]) => n + l.length, 0), g.length);
  const keys = groups.map(([k]) => k);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))));
  for (const [k, l] of groups) for (const x of l) assert.equal(glossary.groupKey(x), k);
  const html = String(glossary.render(ctxOf('zh-TW', '/glossary/')));
  for (const x of g) assert.ok(html.includes(`id="${x.id}"`), x.id);
  assert.match(html, /<form class="c-glossary__filter" data-glossary-filter[^>]* hidden>/);
  const mpox = html.match(/<div class="c-glossary__row" data-q="([^"]*)"/g).find((r) => r.includes('mpox'));
  assert.ok(mpox.includes('猴痘'), '舊稱可搜尋');
  assert.deepEqual(glossary.pages(), [{ path: '/glossary/', lang: '*', props: {} }]);
});
