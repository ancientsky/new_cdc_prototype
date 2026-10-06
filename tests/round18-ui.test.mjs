// 第十八輪：後台登入與角色規則（auth-rules.js、/admin/login/、common.js 閘門）＋ 權責單位可點（unitLink → /about/units/{slug}/）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as A from '../src/client/admin/auth-rules.js';
import * as units from '../src/templates/public/units.mjs';
import * as about from '../src/templates/public/about.mjs';
import * as contact from '../src/templates/public/contact.mjs';
import * as login from '../src/templates/admin/login.mjs';
import * as mine from '../src/templates/admin/mine.mjs';
import { layout as adminLayout } from '../src/templates/admin/_layout.mjs';
import { provenance, unitLink, unitPath } from '../src/templates/public/_partials.mjs';

const site = govern('2026-10-05');
const ctxOf = (lang = 'zh-TW', path = '/about/') => makeCtx(site, lang, { path, alternates: ['zh-TW', 'en'] });
const str = (x) => String(x);

/* ───── 權限規則（純函式） ───── */
test('角色規則：承辦人進不了 AI 開關與疫情發布；治理幕僚可以；資訊室可進 AI 開關但不能發布疫情', () => {
  const editor = A.makeSession(A.DEMO_ACCOUNTS.find((a) => a.sub === 'demo-001'));
  const oasis = A.makeSession(A.DEMO_ACCOUNTS.find((a) => a.unit === 'unit.oasis'));
  const it = A.makeSession(A.DEMO_ACCOUNTS.find((a) => a.unit === 'unit.it'));
  const epi = A.makeSession(A.DEMO_ACCOUNTS.find((a) => a.unit === 'unit.epidemic-intelligence'));
  assert.equal(A.canAccess(editor, 'mine'), true);
  assert.equal(A.canAccess(editor, 'ai-status'), false);
  assert.equal(A.canAccess(editor, 'situation'), false);
  assert.equal(A.canAccess(editor, 'review'), false);
  assert.equal(A.canAccess(oasis, 'ai-status'), true);
  assert.equal(A.canAccess(oasis, 'situation'), true);
  assert.equal(A.canAccess(it, 'ai-status'), true);
  assert.equal(A.canAccess(it, 'situation'), false);
  assert.equal(A.canAccess(epi, 'situation'), true);
  assert.equal(A.canAccess(null, 'login'), true, '登入頁不需登入');
  assert.equal(A.canAccess(null, 'mine'), false);
});

test('單位視角：承辦人鎖在自己單位；總編輯、治理幕僚、平台管理可跨單位', () => {
  const editor = A.makeSession(A.DEMO_ACCOUNTS[0]);
  assert.equal(A.canCrossUnit(editor), false);
  assert.equal(A.canActAsUnit(editor, editor.unit), true);
  assert.equal(A.canActAsUnit(editor, 'unit.pr'), false);
  assert.equal(A.canActAsUnit(editor, 'all'), false);
  for (const u of ['unit.pr', 'unit.oasis', 'unit.it']) {
    const s = A.makeSession(A.DEMO_ACCOUNTS.find((a) => a.unit === u));
    assert.equal(A.canCrossUnit(s), true, u);
    assert.equal(A.canActAsUnit(s, 'all'), true, u);
  }
});

test('工作階段：8 小時到期、閒置 30 分鐘失效、缺角色不建立；稽核事件名稱固定', () => {
  const now = Date.UTC(2026, 9, 5, 1, 0, 0);
  const s = A.makeSession(A.DEMO_ACCOUNTS[0], { now });
  assert.equal(A.sessionProblem(s, now), null);
  assert.equal(A.sessionProblem(s, now + 8 * 3600 * 1000), 'expired');
  assert.equal(A.sessionProblem({ ...s, lastSeen: now }, now + 31 * 60 * 1000), 'idle');
  assert.equal(A.sessionProblem(null), 'none');
  assert.equal(A.sessionProblem({ unit: 'x' }), 'malformed');
  assert.equal(A.makeSession({ name: 'x', unit: 'unit.pr', roles: [] }), null);
  assert.equal(A.makeSession({ name: 'x', unit: 'unit.pr', roles: ['not-a-role'] }), null);
  const e = A.auditEntry('denied', s, '頁面 ai-status', now);
  assert.deepEqual(Object.keys(e), ['at', 'kind', 'sub', 'name', 'unit', 'roles', 'detail']);
  assert.throws(() => A.auditEntry('nope', s));
});

test('示範帳號：單位都在主檔、會上架、姓名已遮罩、角色都存在', () => {
  for (const a of A.DEMO_ACCOUNTS) {
    const u = site.unitById.get(a.unit);
    assert.ok(u && u.publishes !== false, a.unit);
    assert.match(a.name, /[○◯〇]/, `${a.name} 應遮罩`);
    for (const r of a.roles) assert.ok(A.ROLES[r], r);
  }
});

/* ───── 後台頁面 ───── */
test('/admin/login/：有 SSO 模擬表單、示範帳號、角色規則表與稽核表；登入頁不出導覽列、其他頁有登出鈕與 common.js 閘門', () => {
  const ctx = makeCtx(site, 'zh-TW', { path: '/admin/login/', view: 'admin' });
  const body = str(login.render(ctx));
  assert.match(body, /id="lg-form"/);
  assert.match(body, /id="lg-manual-form"/);
  assert.match(body, /id="lg-audit-table"/);
  assert.equal((body.match(/name="acct"/g) ?? []).length, A.DEMO_ACCOUNTS.length);
  assert.match(body, /AI 開關<\/td><td>平台管理、治理幕僚/);
  const pageLogin = str(adminLayout(ctx, { title: '登入', body, adminKey: 'login' }));
  assert.doesNotMatch(pageLogin, /class="adm-nav"/, '登入頁不顯示後台導覽');
  assert.doesNotMatch(pageLogin, /id="adm-logout"/);
  assert.match(pageLogin, /data-admin-page="login"/);
  const pageMine = str(adminLayout(ctx, { title: '我的內容', body: str(mine.render(ctx)), adminKey: 'mine' }));
  assert.match(pageMine, /id="adm-logout"/);
  assert.match(pageMine, /id="adm-who-role"/);
  assert.match(pageMine, /admin\/common\.js/);
  assert.deepEqual(login.pages().map((p) => p.path), ['/admin/login/']);
});

test('common.js：載入時先檢查工作階段，無效導到 /admin/login/?next=；頁面不允許就寫稽核並顯示拒絕卡；login.js 只接受站內 /admin/ 的 next', () => {
  const common = fs.readFileSync(new URL('../src/client/admin/common.js', import.meta.url), 'utf8');
  assert.match(common, /cdc\.admin\.session/);
  assert.match(common, /\/admin\/login\/\?next=/);
  assert.match(common, /audit\('denied'/);
  assert.match(common, /audit\('expired'/);
  assert.match(common, /adm-denied/);
  assert.ok(common.indexOf('export const unitLabel') < common.indexOf('export const gateOk = gate()'), 'gate 要在 unitLabel 定義之後呼叫（TDZ）');
  const lg = fs.readFileSync(new URL('../src/client/admin/login.js', import.meta.url), 'utf8');
  assert.match(lg, /\^\\\/admin\\\/\(\?!login\)/);
});

/* ───── 權責單位可點 ───── */
test('每個單位都有介紹頁（zh-TW 與 en），路徑 /about/units/{slug}/，頁面含簡介、業務、負責內容；主檔新欄位齊備', () => {
  const pages = units.pages(site);
  assert.equal(pages.length, site.master.units.length * 2);
  for (const u of site.master.units) {
    assert.ok(u.slug && u.intro && u.introEn && Array.isArray(u.duties), `${u.id} 缺 slug/intro/introEn/duties`);
    assert.equal(u.introVerified, false, '原型撰寫的簡介一律 unverified');
    assert.match(u.officialUrl, /^https:\/\/www\.cdc\.gov\.tw\//, `${u.id} 缺現行官網網址`);
    assert.equal(unitPath(u), `/about/units/${u.slug}/`);
  }
  const u = site.unitById.get('unit.acute-infectious');
  const html = str(units.render(ctxOf('zh-TW', unitPath(u)), { unit: u }));
  assert.match(html, /<h1>急性傳染病組<\/h1>/);
  assert.match(html, /id="h-duties"/);
  assert.match(html, /diseases\/dengue\//, '列出該單位維護的登革熱頁');
  assert.match(html, /尚待該單位確認/);
  assert.match(html, /CdcOrganization\/Index\/cBX61rWwT5TKpS7BbMzKag/, '連到現行官網組織與職掌頁');
  assert.match(html, /b_NCRMZiFLmXGmwIIY334w/);
  assert.match(html, /預防接種政策之規劃及推動/, '主要業務採處務規程用語');
  const en = str(units.render(ctxOf('en', unitPath(u)), { unit: u }));
  assert.match(en, /Division of Acute Infectious Diseases<\/h1>/);
  const md = units.markdown(ctxOf(), { unit: u });
  assert.match(md, /^# 急性傳染病組/);
  assert.match(md, /## 主要業務/);
  const m = units.meta(ctxOf(), { unit: u });
  assert.equal(m.jsonLd[0]['@type'], 'GovernmentOrganization');
});

test('單位名稱與官網一致：新興傳染病整備組（不是整備應變組）；AI推動辦公室（OASIS）是同一單位、正式名稱；預防醫學辦公室的實際職掌', () => {
  const names = new Set(site.master.units.map((u) => u.name));
  assert.ok(names.has('新興傳染病整備組'));
  assert.ok(!names.has('整備應變組'));
  assert.ok(names.has('AI推動辦公室'));
  assert.equal(site.unitById.get('unit.oasis').nameEn, 'Office of AI Strategy, Innovation, and Synergy (OASIS)');
  assert.ok(!site.unitById.has('unit.ai-office'), '不再有重複的 AI 推動辦公室');
  assert.ok(![...names].some((n) => n.includes('資料與 AI 組幕僚')));
  assert.ok(site.unitById.get('unit.preventive-medicine').duties.some((d) => d.includes('防疫醫師')));
  const org = str(about.orgChart(ctxOf()));
  assert.match(org, /c-org__official/);
});

test('內容來歷條的權責單位是連結；組織圖單位卡與聯絡頁單位表都連到單位介紹頁；非中英語言連到英文版', () => {
  const dengue = site.byId.get('disease.dengue');
  const zh = str(provenance(ctxOf('zh-TW', '/diseases/dengue/'), dengue));
  assert.match(zh, /<a class="c-unitlink" href="[^"]*\/about\/units\/acute-infectious\/"[^>]*>急性傳染病組<\/a>/);
  const vi = str(unitLink(ctxOf('vi', '/diseases/dengue/'), 'unit.acute-infectious'));
  assert.match(vi, /\/en\/about\/units\/acute-infectious\//);
  assert.match(vi, /hreflang="en"/);
  assert.equal(str(unitLink(ctxOf(), 'unit.nope')), 'unit.nope', '找不到單位退回純文字');
  const org = str(about.orgChart(ctxOf()));
  assert.match(org, /class="c-org__name"><a href="[^"]*\/about\/units\/director\/">署長室<\/a>/);
  const ct = str(contact.render(ctxOf('zh-TW', '/contact/')));
  assert.match(ct, /\/about\/units\/secretariat\/">秘書室<\/a>/);
});

test('dist 若已建置：單位頁與登入頁實際輸出，且登入頁 noindex', { skip: !fs.existsSync(new URL('../dist/admin/login/index.html', import.meta.url)) }, () => {
  const d = (p) => fs.readFileSync(new URL(`../dist/${p}`, import.meta.url), 'utf8');
  assert.match(d('admin/login/index.html'), /noindex/);
  assert.match(d('about/units/quarantine/index.html'), /檢疫組/);
  assert.match(d('en/about/units/quarantine/index.html'), /Division of Quarantine/);
  assert.ok(fs.existsSync(new URL('../dist/about/units/quarantine.md', import.meta.url)));
});
