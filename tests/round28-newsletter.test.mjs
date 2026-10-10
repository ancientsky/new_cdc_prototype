// 第二十八輪（Issue #38）：電子報訂閱——/subscribe/ 頁、RSS 頻道目錄、LINE 待確認標記、頁尾連結、
// 訂閱狀態機（雙重確認、冪等、逾期、不洩漏、節流）、HTTP 模擬後端與 .eml 標頭（RFC 2369／8058）、瀏覽器模擬後端與後端偵測、週摘要產生器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { buildFeeds } from '../scripts/lib/emit-seo.mjs';
import { feedCatalog, parseRss } from '../scripts/lib/feed-catalog.mjs';
import { layout } from '../src/templates/layout.mjs';
import * as subscribe from '../src/templates/public/subscribe.mjs';
import { t, STRINGS } from '../src/client/i18n.js';
import { clientKeys } from '../scripts/lib/i18n-split.mjs';
import { TOPIC_IDS, validateSubscription, validatePreferences, emailProblem, composeMail, composeDigest, maskEmail, isToken, CONFIRM_TTL_MS } from '../src/client/subscribe-rules.js';
import { createService } from '../src/client/subscribe-service.js';
import { createBrowserBackend, createHttpBackend, detectBackend } from '../src/client/subscribe.js';
import { buildEml, parseEml, encodeWord, safeHeader } from '../scripts/lib/mail-outbox.mjs';
import { createSubscriptionApi, readSubscriptions } from '../scripts/lib/subscribe-mock.mjs';
import { buildDigest, collectDigestItems } from '../scripts/newsletter-digest.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const site = govern('2026-10-10');
const ctxOf = (lang = 'zh-TW') => makeCtx(site, lang, { path: '/subscribe/', alternates: ['zh-TW', 'en'] });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cdc-sub-'));
const GOOD = { email: 'Reader@Example.com', topics: ['news', 'situation'], frequency: 'weekly', lang: 'zh-TW', consent: true };

/* ───────── 頁面與頻道目錄 ───────── */
test('主題清單＝RSS 頻道（emit-seo 實際輸出），頻道目錄從輸出讀回、網址與標題都在', () => {
  const files = Object.keys(buildFeeds(site));
  assert.deepEqual(files.map((f) => f.replace(/^feeds\//, '').replace(/\.xml$/, '')), TOPIC_IDS);
  const cat = feedCatalog(site);
  assert.equal(cat.length, 7);
  for (const f of cat) {
    assert.ok(f.url.endsWith(`/feeds/${f.id}.xml`), f.url);
    assert.ok(f.title.includes('疾病管制署'), f.title);
    assert.equal(f.count, f.items.length);
  }
  assert.ok(cat.find((f) => f.id === 'news').items.length > 0);
  assert.equal(subscribe.checkTopics(site).length, 7);
});

test('/subscribe/：七語都有；列出全部頻道（網址與 buildFeeds 一致）、RSS 說明三步驟、LINE 區塊與「待確認」標記、Email 區塊', () => {
  assert.deepEqual(subscribe.pages(), [{ path: '/subscribe/', lang: '*', props: {} }]);
  const htmlZh = String(subscribe.render(ctxOf()));
  for (const f of feedCatalog(site)) {
    assert.ok(htmlZh.includes(`data-feed="${f.id}"`), f.id);
    assert.ok(htmlZh.includes(`href="${f.url}"`), f.url);
    assert.ok(htmlZh.includes(`data-copy-text="${f.url}"`), '複製鈕');
  }
  assert.equal((htmlZh.match(/<li>(選一個 RSS|在下表複製|在閱讀器選)/g) ?? []).length, 3);
  assert.ok(htmlZh.includes('id="line"') && htmlZh.includes('@taiwancdc') && htmlZh.includes('疾管家'));
  assert.equal(subscribe.LINE_ACCOUNT.verified, false);
  assert.ok(htmlZh.includes('data-unverified') && htmlZh.includes('待確認'), 'LINE 未核對 ⇒ 顯示待確認');
  assert.ok(htmlZh.includes('id="email"') && htmlZh.includes('data-sub-app'));
  assert.ok(htmlZh.includes('原型示範：資料只存在你的瀏覽器，不會寄出'), '預設橫幅文字');
  assert.ok(htmlZh.includes('/policy/privacy/'), '同意旁連到隱私權政策');
  assert.ok(htmlZh.includes('name="website"'), '蜜罐');
  const htmlEn = String(subscribe.render(ctxOf('en')));
  assert.ok(htmlEn.includes('Subscribe') || htmlEn.includes('RSS feeds'));
  assert.ok(htmlEn.includes('To be confirmed'));
  const m = subscribe.meta(ctxOf());
  assert.deepEqual(m.scripts, ['/assets/js/subscribe.js']);
  assert.ok(m.styles.includes('/assets/styles/subscribe.css'));
});

test('頁面沒有第三方腳本、inline script；用戶端程式不用 innerHTML／eval', () => {
  const htmlZh = String(layout(ctxOf(), { body: String(subscribe.render(ctxOf())), ...subscribe.meta(ctxOf()) }));
  assert.ok(!/<script[^>]+src="https?:\/\//.test(htmlZh));
  assert.ok(!/<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>[^<]/.test(htmlZh.replace(/<script>try\{var d=document[\s\S]*?<\/script>/, '')), '除版面既有的 EARLY_JS 外沒有新的 inline script');
  for (const f of ['src/client/subscribe.js', 'src/client/subscribe-service.js', 'src/client/subscribe-rules.js']) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code), f);
  }
});

test('頁尾「服務」欄有 /subscribe/ 連結與一行說明；七語字串齊備且非英文的語言有各自翻譯', () => {
  for (const lang of ['zh-TW', 'en', 'ja']) {
    const html = String(layout(makeCtx(site, lang, { path: '/', alternates: ['zh-TW'] }), { body: '', item: null }));
    const col = html.match(/<nav class="site-footer__col" aria-labelledby="ft-svc">[\s\S]*?<\/nav>/)[0];
    assert.ok(col.includes('/subscribe/"'), `${lang} 頁尾連結`);
    assert.ok(col.includes(t(lang, 'footer.subscribe.note')), `${lang} 一行說明`);
  }
  const keys = Object.keys(STRINGS.en).filter((k) => k.startsWith('subscribe.') || k.startsWith('footer.subscribe'));
  assert.ok(keys.length > 90, `subscribe 字串 ${keys.length}`);
  for (const lang of ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th']) {
    for (const k of keys) assert.ok(STRINGS[lang][k], `${lang} ${k}`);
  }
  assert.notEqual(t('th', 'subscribe.title'), t('en', 'subscribe.title'));
  // 用戶端會用到的 key（含動態前綴 subscribe.err.、subscribe.status.）都被拆進 per-lang 檔
  const used = new Set(clientKeys(Object.keys(STRINGS['zh-TW'])));
  for (const k of ['subscribe.err.email.invalid', 'subscribe.status.confirmed', 'subscribe.banner', 'subscribe.banner.http', 'subscribe.sent.text', 'subscribe.inbox.h']) assert.ok(used.has(k), k);
});

test('隱私權政策與移轉清單：新增電子報資料說明；newsletter 項目反映已做與待辦', () => {
  const body = site.byId.get('page.privacy').bodyMarkdown;
  assert.ok(body.includes('電子報訂閱') && body.includes('雙重確認') && body.includes('原型現況'));
  assert.ok(site.byId.get('page.privacy').i18n.en.bodyMarkdown.includes('double opt-in'));
  const item = site.migrationLists.find((m) => m.id === 'migration.legacy-services').items.find((i) => i.key === 'newsletter');
  assert.equal(item.newPath, '/subscribe/');
  for (const w of ['SPF', 'DKIM', 'DMARC', '待確認', 'newsletter-digest']) assert.ok(item.note.includes(w), w);
});

/* ───────── 規則 ───────── */
test('驗證：信箱格式、主題、頻率、語言、同意；標頭注入與非 ASCII 位址被擋', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com.tw', "o'brien@example.org"]) assert.equal(emailProblem(ok), null, ok);
  for (const bad of ['', 'x', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b.c', '.a@b.com', 'a.@b.com', 'a..b@c.com', 'a@b.com\r\nBcc: x@y.z', '王@例子.台灣', `${'a'.repeat(250)}@b.com`]) assert.ok(emailProblem(bad), JSON.stringify(bad));
  assert.equal(emailProblem(''), 'required');
  const ok = validateSubscription(GOOD);
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { email: 'reader@example.com', topics: ['news', 'situation'], frequency: 'weekly', lang: 'zh-TW' });
  const bad = validateSubscription({ email: 'x', topics: ['news', 'evil'], frequency: 'daily', lang: 'ja', consent: 'true' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['consent', 'email', 'frequency', 'lang', 'topics']);
  assert.equal(validateSubscription({ ...GOOD, topics: 'news' }).errors.topics, 'required');
  assert.deepEqual(validateSubscription({ ...GOOD, topics: ['situation', 'news', 'news'] }).value.topics, ['news', 'situation'], '去重並依主題順序');
  assert.ok(validatePreferences({ topics: ['news'], frequency: 'instant', lang: 'en' }).ok);
  assert.equal(validatePreferences({ topics: [], frequency: 'instant', lang: 'en' }).errors.topics, 'required');
  assert.equal(maskEmail('reader@example.com'), 'r***@example.com');
  assert.ok(isToken(crypto.randomUUID()) && !isToken('abc') && !isToken('../../etc/passwd'));
  assert.throws(() => safeHeader('a\r\nBcc: x'));
});

test('信件內容：確認信含連結與 48 小時說明、HTML 轉義、中英各一份；週摘要依主題分組', () => {
  const links = { confirmUrl: 'https://x.test/subscribe/?confirm=T', manageUrl: 'https://x.test/m', unsubscribeUrl: 'https://x.test/u', privacyUrl: 'https://x.test/p' };
  const zh = composeMail('confirm', { lang: 'zh-TW', links, sub: { topics: ['news'], frequency: 'weekly', lang: 'zh-TW' } });
  assert.ok(zh.text.includes('https://x.test/subscribe/?confirm=T') && zh.text.includes('48 小時') && zh.text.includes('原型示範'));
  assert.ok(zh.html.includes('href="https://x.test/subscribe/?confirm=T"') && zh.html.startsWith('<!doctype html>'));
  const en = composeMail('confirm', { lang: 'en', links, sub: { topics: ['news'], frequency: 'instant', lang: 'en' } });
  assert.ok(en.subject.startsWith('Please confirm') && en.text.includes('48 hours'));
  const evil = composeDigest({ lang: 'en', from: '2026-10-04', to: '2026-10-10', items: [{ topic: 'news', title: '<img src=x onerror=alert(1)>', link: 'https://x.test/?a=1&b="2"', date: '2026-10-09', summary: '' }] });
  assert.ok(!evil.html.includes('<img') && evil.html.includes('&lt;img') && evil.html.includes('&quot;2&quot;'), '不轉義就會變成注入');
  assert.ok(composeDigest({ lang: 'zh-TW', from: 'a', to: 'b', items: [] }).text.includes('沒有新內容'));
  assert.ok(CONFIRM_TTL_MS === 48 * 3600 * 1000);
});

test('.eml：RFC 2047 主旨與寄件人、multipart/alternative（純文字＋HTML）、CRLF、可解析回原文；標頭不得含換行', () => {
  const mail = composeMail('welcome', { lang: 'zh-TW', links: { manageUrl: 'https://x.test/m', unsubscribeUrl: 'https://x.test/u' }, sub: { topics: ['news'], frequency: 'weekly', lang: 'zh-TW' } });
  const eml = buildEml({ fromName: '疾管署（原型示範）', to: 'a@example.com', subject: mail.subject, text: mail.text, html: mail.html, headers: { 'List-Unsubscribe': '<https://x.test/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
  assert.ok(eml.raw.includes('\r\n\r\n') && /^From: =\?UTF-8\?B\?[^?]+\?= <no-reply@cdc-prototype\.invalid>/m.test(eml.raw));
  assert.ok(eml.raw.includes('Content-Type: multipart/alternative; boundary='));
  assert.ok(eml.raw.indexOf('text/plain') < eml.raw.indexOf('text/html'));
  assert.ok(!/[^\x00-\x7f]/.test(eml.raw), '整封信是純 ASCII（中文都在 base64 或 RFC 2047 裡）'); // eslint-disable-line no-control-regex
  for (const line of eml.raw.split('\r\n')) assert.ok(line.length <= 998, '行長');
  const p = parseEml(eml.raw);
  assert.equal(p.headers.subject, mail.subject);
  assert.equal(p.headers.from, '疾管署（原型示範） <no-reply@cdc-prototype.invalid>');
  assert.equal(p.text.replace(/\r\n/g, '\n'), mail.text);
  assert.equal(p.html.replace(/\r\n/g, '\n'), mail.html);
  assert.equal(p.headers['list-unsubscribe-post'], 'List-Unsubscribe=One-Click');
  assert.ok(encodeWord('x'.repeat(10)) === 'x'.repeat(10));
  assert.ok(encodeWord('長'.repeat(60)).split('\r\n').length > 1, '長主旨拆成多個 encoded-word');
  assert.throws(() => buildEml({ to: 'a@example.com\r\nBcc: z@z.z', subject: 's', text: 't', html: 'h' }));
});

/* ───────── 狀態機 ───────── */
function memService(over = {}) {
  const db = { version: 1, subscriptions: [] };
  const mails = [];
  let clock = Date.parse('2026-10-10T00:00:00Z');
  const svc = createService({ load: () => db, save: () => {}, mail: (kind, sub) => mails.push({ kind, sub: { ...sub } }), now: () => clock, ...over });
  return { svc, db, mails, advance: (ms) => { clock += ms; } };
}

test('狀態機：訂閱→待確認→確認→改偏好→退訂；每步寄對的信；token 是 UUID；退訂清掉偏好', () => {
  const { svc, db, mails } = memService();
  assert.deepEqual(svc.subscribe(GOOD), { status: 202, body: { status: 'pending' } });
  assert.deepEqual(mails.map((m) => m.kind), ['confirm']);
  const s = db.subscriptions[0];
  assert.equal(s.status, 'pending'); assert.equal(s.email, 'reader@example.com');
  assert.ok(isToken(s.confirmToken) && isToken(s.manageToken) && s.confirmToken !== s.manageToken);
  assert.equal(svc.status(s.manageToken).body.status, 'pending');
  const c = svc.confirm(s.confirmToken);
  assert.equal(c.status, 200); assert.equal(c.body.manageToken, s.manageToken); assert.equal(c.body.email, 'r***@example.com');
  assert.deepEqual(mails.map((m) => m.kind), ['confirm', 'welcome']);
  assert.equal(svc.confirm(s.confirmToken).body.already, true, '冪等：郵件安全掃描器預先點開也不出錯');
  assert.equal(mails.length, 2, '重複確認不重寄歡迎信');
  assert.equal(svc.update(s.manageToken, { topics: ['careers'], frequency: 'instant', lang: 'en' }).status, 200);
  assert.deepEqual([s.topics, s.frequency, s.lang], [['careers'], 'instant', 'en']);
  assert.equal(svc.update(s.manageToken, { topics: ['nope'], frequency: 'instant', lang: 'en' }).status, 400);
  assert.equal(svc.unsubscribe(s.manageToken).status, 200);
  assert.deepEqual(mails.map((m) => m.kind), ['confirm', 'welcome', 'goodbye']);
  assert.deepEqual([s.status, s.topics, s.confirmToken], ['unsubscribed', [], null]);
  assert.equal(svc.unsubscribe(s.manageToken).status, 200); assert.equal(mails.length, 3, '退訂冪等，不重寄');
  assert.equal(svc.update(s.manageToken, GOOD).status, 404);
});

test('狀態機：確認逾期 48 小時、未知／假 token 一律 404；已訂閱者再申請不改設定也不洩漏；退訂後可重新訂閱；蜜罐與驗證錯誤不寄信', () => {
  const { svc, db, mails, advance } = memService();
  svc.subscribe(GOOD);
  const s = db.subscriptions[0];
  advance(CONFIRM_TTL_MS + 1000);
  assert.deepEqual(svc.confirm(s.confirmToken), { status: 410, body: { error: 'expired' } });
  assert.equal(svc.confirm('not-a-token').status, 404);
  assert.equal(svc.confirm(crypto.randomUUID()).status, 404);
  assert.equal(svc.status('x').status, 404);
  svc.subscribe(GOOD); // 重新申請 → 新 token
  assert.equal(svc.confirm(s.confirmToken).status, 200);
  const before = JSON.stringify(s);
  const again = svc.subscribe({ ...GOOD, topics: ['procurement'], frequency: 'instant' });
  assert.deepEqual(again, { status: 202, body: { status: 'pending' } }, '回應與全新信箱完全相同');
  assert.equal(JSON.stringify(s), before, '已確認者的設定不被別人改掉');
  assert.equal(mails.at(-1).kind, 'already');
  svc.unsubscribe(s.manageToken);
  svc.subscribe({ ...GOOD, topics: ['procurement'] });
  assert.equal(s.status, 'pending'); assert.deepEqual(s.topics, ['procurement']);
  const n = mails.length;
  assert.equal(svc.subscribe({ ...GOOD, website: 'http://spam' }).status, 202); assert.equal(mails.length, n);
  assert.equal(svc.subscribe({ ...GOOD, consent: false, email: 'z@example.com' }).status, 400); assert.equal(mails.length, n);
  assert.equal(db.subscriptions.length, 1);
  assert.equal(svc.manageLink('nobody@example.com').status, 202); assert.equal(mails.length, n, '沒訂閱的信箱：同樣 202、不寄信');
});

test('狀態機：節流（同一信箱 10 分鐘 3 次、同一來源 10 次，回 429＋retryAfter）；7 天未確認自動清除', () => {
  const { svc, mails, advance, db } = memService();
  for (let i = 0; i < 3; i++) assert.equal(svc.subscribe(GOOD).status, 202);
  const r = svc.subscribe(GOOD);
  assert.equal(r.status, 429); assert.ok(r.body.retryAfter > 0 && r.headers['Retry-After']);
  assert.equal(mails.length, 3);
  advance(11 * 60 * 1000);
  assert.equal(svc.subscribe(GOOD).status, 202);
  const m2 = memService();
  for (let i = 0; i < 10; i++) assert.equal(m2.svc.subscribe({ ...GOOD, email: `u${i}@example.com` }).status, 202);
  assert.equal(m2.svc.subscribe({ ...GOOD, email: 'u11@example.com' }).status, 429);
  m2.advance(8 * 24 * 3600 * 1000);
  m2.svc.status(crypto.randomUUID());
  assert.equal(m2.db.subscriptions.length, 0, '超過 7 天未確認 ⇒ 清除');
  assert.equal(db.subscriptions.length, 1);
});

/* ───────── HTTP 模擬後端 ───────── */
async function withApi(fn, opts = {}) {
  const dir = tmp();
  const api = createSubscriptionApi({ dataFile: path.join(dir, 'subs.json'), outboxDir: path.join(dir, 'outbox'), basePath: '', ...opts });
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (!(await api.handle(req, res, u.pathname, u.searchParams))) { res.statusCode = 404; res.end('static'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn({ base, dir, api }); } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const post = (base, p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('HTTP 模擬後端：health、訂閱→.eml（From／List-Unsubscribe／List-Unsubscribe-Post／純文字＋HTML）→確認→狀態→更新→一鍵退訂（RFC 8058 form POST）', async () => {
  await withApi(async ({ base, dir }) => {
    const h = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(h, { ok: true, service: 'cdc-prototype-subscriptions', mode: 'mock-http' });
    assert.equal((await fetch(`${base}/not-api`)).status, 404);

    const r = await post(base, '/api/subscriptions', GOOD);
    assert.equal(r.status, 202); assert.deepEqual(await r.json(), { status: 'pending' });
    const outbox = path.join(dir, 'outbox');
    const files = fs.readdirSync(outbox);
    assert.equal(files.length, 1); assert.ok(files[0].endsWith('-confirm.eml'));
    const raw = fs.readFileSync(path.join(outbox, files[0]), 'utf8');
    const eml = parseEml(raw);
    assert.ok(eml.headers.from.endsWith('<no-reply@cdc-prototype.invalid>'));
    assert.equal(eml.headers.to, '<reader@example.com>');
    assert.match(eml.headers['list-unsubscribe'], /^<http:\/\/127\.0\.0\.1:\d+\/api\/subscriptions\/unsubscribe\?token=[0-9a-f-]{36}>, <mailto:unsubscribe@cdc-prototype\.invalid\?subject=unsubscribe>$/);
    assert.equal(eml.headers['list-unsubscribe-post'], 'List-Unsubscribe=One-Click');
    assert.ok(eml.headers['x-cdc-prototype'].includes('never sent') && eml.headers['message-id'].endsWith('@cdc-prototype.invalid>'));
    assert.ok(eml.text.includes('48 小時') && eml.html.includes('<a href="http://127.0.0.1:'));
    const confirmUrl = /http:\/\/\S+\/subscribe\/\?confirm=([0-9a-f-]{36})/.exec(eml.text);
    assert.ok(confirmUrl, '確認連結指向 /subscribe/?confirm=');
    const token = confirmUrl[1];

    // 確認前：status 為 pending；confirm 後 confirmed，並寄歡迎信（含管理與退訂連結）
    const store = () => readSubscriptions(path.join(dir, 'subs.json')).subscriptions[0];
    assert.equal(store().status, 'pending');
    const c = await (await fetch(`${base}/api/subscriptions/confirm?token=${token}`)).json();
    assert.equal(c.status, 'confirmed'); assert.ok(isToken(c.manageToken));
    assert.equal((await (await fetch(`${base}/api/subscriptions/confirm?token=${token}`)).json()).already, true);
    const files2 = fs.readdirSync(outbox);
    assert.equal(files2.length, 2); assert.ok(files2[1].endsWith('-welcome.eml'));
    const welcome = parseEml(fs.readFileSync(path.join(outbox, files2[1]), 'utf8'));
    assert.ok(welcome.text.includes(`manage=${c.manageToken}`) && welcome.text.includes(`unsubscribe=${c.manageToken}`));

    const st = await (await fetch(`${base}/api/subscriptions/status?token=${c.manageToken}`)).json();
    assert.deepEqual(st, { status: 'confirmed', email: 'r***@example.com', topics: ['news', 'situation'], frequency: 'weekly', lang: 'zh-TW' });
    const up = await post(base, '/api/subscriptions/update', { token: c.manageToken, topics: ['careers'], frequency: 'instant', lang: 'en' });
    assert.equal(up.status, 200);

    // RFC 8058：郵件程式對 List-Unsubscribe 網址 POST，本體 List-Unsubscribe=One-Click，token 在網址
    const oneClick = /<([^>]+unsubscribe\?token=[^>]+)>/.exec(welcome.headers['list-unsubscribe'])[1];
    const u = await fetch(oneClick, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(u.status, 200); assert.deepEqual(await u.json(), { status: 'unsubscribed' });
    assert.equal(store().status, 'unsubscribed'); assert.deepEqual(store().topics, []);
    assert.ok(fs.readdirSync(outbox).at(-1).endsWith('-goodbye.eml'));
    assert.equal((await post(base, '/api/subscriptions/unsubscribe', { token: crypto.randomUUID() })).status, 404);
    assert.equal((await post(base, '/api/subscriptions/unsubscribe', { token: 'x' })).status, 404);
  });
});

test('HTTP 模擬後端：驗證錯誤 400（不回顯輸入）、跨站 Origin 403、過大 413、非 JSON 415、壞 JSON 400、節流 429、蜜罐不寄信、dev outbox 只給本機', async () => {
  await withApi(async ({ base, dir }) => {
    const bad = await post(base, '/api/subscriptions', { email: '<script>alert(1)</script>', topics: [], frequency: 'x', lang: 'x' });
    assert.equal(bad.status, 400);
    const bj = await bad.json();
    assert.equal(bj.error, 'invalid'); assert.deepEqual(Object.keys(bj.fields).sort(), ['consent', 'email', 'frequency', 'lang', 'topics']);
    assert.ok(!JSON.stringify(bj).includes('script'), '錯誤回應不回顯使用者輸入');
    assert.equal((await post(base, '/api/subscriptions', GOOD, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(base, '/api/subscriptions', GOOD, { Origin: 'null' })).status, 403);
    assert.equal((await post(base, '/api/subscriptions', { ...GOOD, pad: 'x'.repeat(9000) })).status, 413);
    assert.equal((await fetch(`${base}/api/subscriptions`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
    assert.equal((await fetch(`${base}/api/subscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' })).status, 400);
    assert.equal((await fetch(`${base}/api/subscriptions`, { method: 'PUT' })).status, 405);
    assert.equal(fs.existsSync(path.join(dir, 'outbox')), false, '以上都不應寄信');
    assert.equal((await post(base, '/api/subscriptions', { ...GOOD, website: 'spam' })).status, 202);
    assert.equal(fs.existsSync(path.join(dir, 'outbox')), false, '蜜罐不寄信');
    for (let i = 0; i < 2; i++) assert.equal((await post(base, '/api/subscriptions', GOOD)).status, 202);
    assert.equal((await post(base, '/api/subscriptions', GOOD)).status, 202);
    const limited = await post(base, '/api/subscriptions', GOOD);
    assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
    // 本機 outbox 列表（loopback）
    const list = await (await fetch(`${base}/api/dev/outbox`)).json();
    assert.equal(list.messages.length, 3); assert.ok(list.messages[0].subject.includes('請確認訂閱'));
    const raw = await (await fetch(`${base}/api/dev/outbox/${list.messages[0].file}`)).text();
    assert.ok(raw.startsWith('From: '));
    assert.equal((await fetch(`${base}/api/dev/outbox/..%2F..%2Fpackage.json`)).status, 404);
  });
  await withApi(async ({ base }) => { assert.equal((await fetch(`${base}/api/dev/outbox`)).status, 404, 'devOutbox:false ⇒ 沒有此端點'); }, { devOutbox: false });
});

test('HTTP 模擬後端：忘了管理連結——已訂閱者收到 manage 信，沒訂閱者同樣 202 且不寄信', async () => {
  await withApi(async ({ base, dir }) => {
    await post(base, '/api/subscriptions', GOOD);
    const token = /confirm=([0-9a-f-]{36})/.exec(parseEml(fs.readFileSync(path.join(dir, 'outbox', fs.readdirSync(path.join(dir, 'outbox'))[0]), 'utf8')).text)[1];
    await fetch(`${base}/api/subscriptions/confirm?token=${token}`);
    const n = fs.readdirSync(path.join(dir, 'outbox')).length;
    const a = await post(base, '/api/subscriptions/manage-link', { email: 'nobody@example.com' });
    assert.equal(a.status, 202); assert.equal(fs.readdirSync(path.join(dir, 'outbox')).length, n);
    const b = await post(base, '/api/subscriptions/manage-link', { email: GOOD.email });
    assert.equal(b.status, 202); assert.deepEqual(await b.json(), await a.json());
    assert.ok(fs.readdirSync(path.join(dir, 'outbox')).at(-1).endsWith('-manage.eml'));
    assert.equal((await post(base, '/api/subscriptions/manage-link', { email: 'bad' })).status, 400);
  });
});

test('serve.mjs 掛載 /api（不影響靜態檔）：真的啟動、health 回應、其他路徑照舊 404.html', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>'); fs.writeFileSync(path.join(dir, '404.html'), 'nf');
  const port = 40000 + Math.floor(Math.random() * 2000);
  const { spawn } = await import('node:child_process');
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, DIST_DIR: dir, BASE_PATH: '', SUBSCRIPTIONS_FILE: path.join(dir, 's.json'), OUTBOX_DIR: path.join(dir, 'o') } });
  try {
    let h;
    for (let i = 0; i < 40 && !h; i++) { try { h = await fetch(`http://127.0.0.1:${port}/api/health`); } catch { await new Promise((r) => setTimeout(r, 150)); } }
    assert.equal((await h.json()).service, 'cdc-prototype-subscriptions');
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), '<h1>ok</h1>');
    assert.equal((await fetch(`http://127.0.0.1:${port}/missing`)).status, 404);
  } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ───────── 瀏覽器模擬後端與偵測 ───────── */
const fakeStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), raw: m }; };
const linksFor = (s) => ({ confirmUrl: s.confirmToken ? `https://x.test/subscribe/?confirm=${s.confirmToken}` : undefined, manageUrl: `https://x.test/subscribe/?manage=${s.manageToken}`, unsubscribeUrl: `https://x.test/subscribe/?unsubscribe=${s.manageToken}` });

test('瀏覽器模擬後端：走完整流程、信放進模擬收件匣、資料只在 storage；storage 壞掉也不丟例外', async () => {
  const storage = fakeStorage();
  const b = createBrowserBackend({ storage, linksFor });
  assert.equal(b.kind, 'mock-browser');
  assert.deepEqual(await b.subscribe(GOOD), { ok: true, status: 'pending' });
  let inbox = b.inbox();
  assert.equal(inbox.length, 1); assert.equal(inbox[0].kind, 'confirm'); assert.ok(inbox[0].text.includes('48 小時'));
  const token = /confirm=([0-9a-f-]{36})/.exec(inbox[0].links.confirm)[1];
  const c = await b.confirm(token);
  assert.equal(c.ok, true); assert.equal(c.status, 'confirmed');
  assert.deepEqual(b.inbox().map((m) => m.kind), ['welcome', 'confirm']);
  assert.equal((await b.status(c.manageToken)).topics.join(), 'news,situation');
  assert.equal((await b.update(c.manageToken, { topics: ['notices'], frequency: 'instant', lang: 'en' })).ok, true);
  assert.equal((await b.unsubscribe(c.manageToken)).status, 'unsubscribed');
  assert.equal((await b.confirm(crypto.randomUUID())).error, 'notfound');
  assert.equal((await b.subscribe({ ...GOOD, email: 'bad' })).error, 'invalid');
  assert.ok(!JSON.stringify(Object.fromEntries(storage.raw)).includes('undefined'));
  b.clearInbox(); assert.equal(b.inbox().length, 0);
  inbox = null;
  const broken = createBrowserBackend({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, linksFor });
  assert.equal((await broken.subscribe(GOOD)).ok, true, '私密視窗／封鎖儲存：退回記憶體');
  const rl = createBrowserBackend({ storage: fakeStorage(), linksFor });
  for (let i = 0; i < 3; i++) await rl.subscribe(GOOD);
  const r = await rl.subscribe(GOOD);
  assert.deepEqual([r.ok, r.error], [false, 'rate']); assert.ok(r.retryAfter > 0);
});

test('後端偵測：health 回對的 service ⇒ HTTP；404／錯誤格式／連線失敗／逾時／?backend=browser ⇒ 瀏覽器模擬', async () => {
  const mk = () => createBrowserBackend({ storage: fakeStorage(), linksFor });
  const resp = (ok, body) => async () => ({ ok, json: async () => body });
  assert.equal((await detectBackend({ fetchFn: resp(true, { ok: true, service: 'cdc-prototype-subscriptions' }), makeBrowser: mk })).kind, 'mock-http');
  assert.equal((await detectBackend({ fetchFn: resp(false, {}), makeBrowser: mk })).kind, 'mock-browser', 'GitHub Pages：404');
  assert.equal((await detectBackend({ fetchFn: resp(true, { service: 'something-else' }), makeBrowser: mk })).kind, 'mock-browser');
  assert.equal((await detectBackend({ fetchFn: async () => { throw new TypeError('fetch failed'); }, makeBrowser: mk })).kind, 'mock-browser');
  assert.equal((await detectBackend({ fetchFn: (_u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))), timeoutMs: 30, makeBrowser: mk })).kind, 'mock-browser', '逾時');
  assert.equal((await detectBackend({ force: 'browser', fetchFn: resp(true, { service: 'cdc-prototype-subscriptions' }), makeBrowser: mk })).kind, 'mock-browser');
});

test('HTTP 後端轉接：錯誤碼對應、網路失敗 ⇒ network、非 JSON 回應 ⇒ server', async () => {
  const calls = [];
  const be = createHttpBackend({ base: '/base', fetchFn: async (u, o) => { calls.push([u, o.method]); return { status: 429, json: async () => ({ error: 'rate', retryAfter: 9 }) }; } });
  assert.deepEqual(await be.subscribe(GOOD), { ok: false, error: 'rate', status: 429, fields: undefined, retryAfter: 9 });
  await be.confirm('a b'); await be.status('t'); await be.unsubscribe('t'); await be.manageLink('a@b.co'); await be.update('t', {});
  assert.deepEqual(calls.map((c) => c.join(' ')), ['/base/api/subscriptions POST', '/base/api/subscriptions/confirm?token=a%20b GET', '/base/api/subscriptions/status?token=t GET', '/base/api/subscriptions/unsubscribe POST', '/base/api/subscriptions/manage-link POST', '/base/api/subscriptions/update POST']);
  assert.equal((await createHttpBackend({ fetchFn: async () => { throw new Error('x'); } }).subscribe(GOOD)).error, 'network');
  assert.equal((await createHttpBackend({ fetchFn: async () => ({ status: 502, json: async () => { throw new Error('html'); } }) }).subscribe(GOOD)).error, 'server');
});

/* ───────── 週摘要 ───────── */
test('週摘要：依主題分組、只收期間內的項目、與 RSS 同一份資料；個人化版有退訂連結；範本版留合併欄位', () => {
  const cat = feedCatalog(site);
  const d = collectDigestItems(site, { today: '2026-10-10', days: 30 });
  assert.equal(d.from, '2026-09-11'); assert.equal(d.to, '2026-10-10');
  assert.ok(d.items.length > 0);
  for (const it of d.items) {
    assert.ok(it.date >= d.from && it.date <= d.to);
    assert.ok(cat.find((f) => f.id === it.topic).items.some((x) => x.link === it.link && x.title === it.title), `${it.title} 必須出現在 ${it.topic} 的 RSS`);
  }
  assert.equal(collectDigestItems(site, { today: '2026-10-10', days: 30, topics: ['situation'] }).items.every((i) => i.topic === 'situation'), true);
  assert.equal(collectDigestItems(site, { today: '2020-01-01', days: 7 }).items.length, 0);
  const tpl = buildDigest(site, { today: '2026-10-10', days: 30 });
  assert.ok(tpl.subject.includes('2026-09-11') && tpl.text.includes('{{unsubscribe_url}}') && tpl.html.includes('{{manage_url}}'));
  assert.ok(tpl.text.includes('■ ') && tpl.itemCount === d.items.length);
  const en = buildDigest(site, { today: '2026-10-10', days: 30, lang: 'en', links: { manageUrl: 'https://x.test/m', unsubscribeUrl: 'https://x.test/u' } });
  assert.ok(en.subject.startsWith('Taiwan CDC weekly digest') && en.text.includes('https://x.test/u') && !en.text.includes('{{'));
  const empty = buildDigest(site, { today: '2020-01-01' });
  assert.ok(empty.text.includes('沒有新內容') && empty.itemCount === 0);
  assert.ok(parseRss(buildFeeds(site)['feeds/news.xml']).items.length > 0);
});

test('週摘要 CLI：範本模式輸出 .txt／.html；--subscribers 只對「已確認＋每週」者各產生一封 .eml（含退訂標頭），沒有新內容不寄', async () => {
  const out = tmp(); const dir = tmp();
  try {
    const run = (args, env = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/newsletter-digest.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
    const a = run(['--today=2026-10-10', '--days=30', `--out=${out}`]);
    assert.equal(a.status, 0, a.stderr);
    assert.ok(fs.existsSync(path.join(out, 'digest-2026-10-10-zh-TW.txt')) && fs.existsSync(path.join(out, 'digest-2026-10-10-zh-TW.html')));
    assert.ok(fs.readFileSync(path.join(out, 'digest-2026-10-10-zh-TW.txt'), 'utf8').includes('{{unsubscribe_url}}'));
    // 準備本機訂閱檔：weekly 已確認（有新內容）、instant 已確認、weekly 待確認、weekly 已退訂
    const mkSub = (email, over) => ({ id: crypto.randomUUID(), email, topics: ['news', 'situation'], frequency: 'weekly', lang: 'zh-TW', status: 'confirmed', manageToken: crypto.randomUUID(), confirmToken: null, ...over });
    const subs = [mkSub('weekly@example.com', {}), mkSub('instant@example.com', { frequency: 'instant' }), mkSub('pending@example.com', { status: 'pending' }), mkSub('gone@example.com', { status: 'unsubscribed', topics: [] }), mkSub('en@example.com', { lang: 'en' })];
    const file = path.join(dir, 'subs.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, subscriptions: subs }));
    const b = run(['--today=2026-10-10', '--days=30', '--subscribers', `--out=${path.join(dir, 'out')}`, '--origin=http://localhost:4173'], { SUBSCRIPTIONS_FILE: file });
    assert.equal(b.status, 0, b.stderr);
    const files = fs.readdirSync(path.join(dir, 'out')).sort();
    assert.equal(files.length, 2, files.join());
    const emls = files.map((f) => parseEml(fs.readFileSync(path.join(dir, 'out', f), 'utf8')));
    assert.deepEqual(emls.map((e) => e.headers.to).sort(), ['<en@example.com>', '<weekly@example.com>']);
    for (const e of emls) {
      assert.match(e.headers['list-unsubscribe'], /^<http:\/\/localhost:4173.*\/api\/subscriptions\/unsubscribe\?token=[0-9a-f-]{36}>/);
      assert.equal(e.headers['list-unsubscribe-post'], 'List-Unsubscribe=One-Click');
      assert.ok(e.text.includes('unsubscribe=') && !e.text.includes('{{'));
    }
    assert.ok(emls.find((e) => e.headers.to.includes('en@')).headers.subject.startsWith('Taiwan CDC weekly digest'));
    const c = run(['--today=2020-01-01', '--subscribers', `--out=${path.join(dir, 'out2')}`], { SUBSCRIPTIONS_FILE: file });
    assert.equal(c.status, 0, c.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'out2')), false, '沒有新內容 ⇒ 不寄空信');
  } finally { fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('.gitignore 排除 .local/（訂閱名單與模擬信件含信箱，不得進版控）；a11y 頁面清單含 /subscribe/', () => {
  assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^\.local\/$/m);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/a11y.mjs'), 'utf8'), /'\/subscribe\/', '\/en\/subscribe\/'/);
});
