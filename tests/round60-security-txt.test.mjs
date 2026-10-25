// 第六十輪（Issue #128）：security.txt（RFC 9116）、/about/official-site/ 頁與頁尾連結。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../site.config.mjs';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { emitSeo, buildSecurityTxt } from '../scripts/lib/emit-seo.mjs';
import { pathOf } from '../scripts/lib/governance.mjs';
import { layout } from '../src/templates/layout.mjs';
import * as page from '../src/templates/public/page.mjs';
import { t } from '../src/client/i18n.js';
import { html } from '../scripts/lib/render.mjs';

const NOW = '2026-10-25T08:00:00Z';
process.env.BUILD_NOW = NOW;
const site = govern('2026-10-25');
const out = new Map();
emitSeo(site, (name, content) => out.set(name, content));
const fieldsOf = (txt) => Object.fromEntries(txt.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));

test('security.txt：標準位置與根目錄備援兩份內容相同、LF、無 CR', () => {
  assert.ok(out.has('.well-known/security.txt') && out.has('security.txt'));
  assert.equal(out.get('.well-known/security.txt'), out.get('security.txt'));
  assert.ok(!out.get('security.txt').includes('\r'));
  assert.ok(out.get('security.txt').endsWith('\n'));
});

test('security.txt：必要欄位齊全，Expires 在建置時間之後且不超過一年', () => {
  const f = fieldsOf(buildSecurityTxt(site));
  assert.ok(f.Contact && f.Contact.length > 0);
  assert.match(f.Expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const exp = Date.parse(f.Expires), now = Date.parse(NOW);
  assert.ok(exp > now && exp - now <= 366 * 86400000);
  assert.equal(exp - now, 90 * 86400000);
  assert.equal(f['Preferred-Languages'], 'zh-TW, en');
  assert.ok(f.Canonical.endsWith('/.well-known/security.txt'));
});

test('security.txt：Contact 未設定時退回聯絡頁；Policy 指向存在的頁面', () => {
  const f = fieldsOf(buildSecurityTxt(site));
  if (!config.security.contact) assert.equal(f.Contact, new URL(`${config.siteUrl}${config.basePath}/contact/`).href);
  else assert.equal(f.Contact, config.security.contact);
  const base = `${config.siteUrl}${config.basePath}`;
  assert.ok(f.Policy.startsWith(base));
  const p = f.Policy.slice(base.length);
  assert.ok(site.collections.pages.some((i) => pathOf(i) === p && i.status === 'published'), p);
});

test('辨識官方網站頁：已發布、路徑 /about/official-site/、有英文版、提到 165 與 1922', () => {
  const item = site.byId.get('page.official-site');
  assert.ok(item); assert.equal(item.status, 'published');
  assert.equal(pathOf(item), '/about/official-site/'); assert.equal(page.standalonePath(item), '/about/official-site/');
  assert.ok(site.unitById.has(item.owner)); assert.ok(item.i18n?.en?.bodyMarkdown);
  for (const s of ['*.cdc.gov.tw', 'https://165.npa.gov.tw/', '1922', '待資訊室填入', '非官方的原型']) assert.ok(item.bodyMarkdown.includes(s), s);
  const ctx = makeCtx(site, 'zh-TW', { path: '/about/official-site/', alternates: ['zh-TW', 'en'] });
  assert.ok(String(page.render(ctx, { item })).includes('cdc.gov.tw'));
});

test('頁尾「關於與政策」欄連到辨識官方網站頁，七語都有標籤', () => {
  const ctx = makeCtx(site, 'zh-TW', { path: '/', alternates: ['zh-TW'] });
  const h = String(layout(ctx, { title: 'x', description: 'y', body: html`<p>x</p>` }));
  assert.ok(h.includes(`href="${config.basePath}/about/official-site/"`));
  for (const l of config.langs) assert.ok(t(l.code, 'footer.officialSite') !== 'footer.officialSite', l.code);
});
