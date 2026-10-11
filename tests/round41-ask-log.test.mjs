// 第四十一輪：智慧問答查詢紀錄（docs/ask-log.md）。
// (1) 設定：askLog 的 mode／endpoint 檢查與 CSP connect-src；(2) 前端 log.js：事件欄位、遮蔽、DNT／GPC、mock 只在本機送、fetch 參數；
// (3) 模擬後端：白名單、伺服器端再遮蔽、寫 NDJSON、413／415／403／429、本機限定的報表端點、保存期限；
// (4) 報表：正規化、k-匿名門檻、疑似同義詞候選（covid → COVID-19）；(5) 答案頁與後台頁的模板、建置產物。
// 一律用暫存目錄，不寫進 repo（民眾問句不得進版控）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { config } from '../site.config.mjs';
import { ROOT, loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { applyConsistency } from '../scripts/lib/consistency.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import { askLogSetting, askLogErrors, askLogOrigins } from '../scripts/lib/forms.mjs';
import { securityHeaders } from '../scripts/lib/emit-headers.mjs';
import { askLogEvent, outcomeOf, sendAskLog, privacyOptOut } from '../src/client/answer/log.js';
import { createAskLogApi, sanitizeEvent, pruneOld, MAX_BODY } from '../scripts/lib/ask-log-mock.mjs';
import {
  buildReport,
  normalizeQuery,
  synonymCandidates,
  loadVocabulary,
  readEvents,
  reportFromDir,
  editDistance,
  formatReport,
} from '../scripts/lib/ask-log-report.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { NAV } from '../src/templates/admin/_partials.mjs';
import * as ask from '../src/templates/public/ask.mjs';
import * as adminAskLog from '../src/templates/admin/ask-log.mjs';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `asklog-${name}-`));
const withAskLog = (askLog) => ({ ...config, askLog });

// ───────────────────────── (1) 設定 ─────────────────────────
test('設定：預設 mock；post 沒有 endpoint、http 端點、mock 卻有 endpoint、未知 mode、保存天數非正整數 ⇒ 建置錯誤', () => {
  assert.deepEqual(askLogErrors(config), [], '目前設定沒有錯誤');
  assert.equal(askLogSetting(withAskLog({})).active, 'mock');
  assert.equal(askLogSetting(withAskLog({})).retentionDays, 90);
  assert.ok(askLogErrors(withAskLog({ mode: 'post', endpoint: '' })).some((e) => e.includes('沒有 endpoint')));
  assert.ok(askLogErrors(withAskLog({ mode: 'post', endpoint: 'http://logs.example.com/x' })).some((e) => e.includes('https://')));
  assert.ok(askLogErrors(withAskLog({ mode: 'mock', endpoint: 'https://logs.cdc.gov.tw/ask' })).some((e) => e.includes('mode=mock')));
  assert.ok(askLogErrors(withAskLog({ mode: 'off', endpoint: 'https://logs.cdc.gov.tw/ask' })).some((e) => e.includes('mode=off')));
  assert.ok(askLogErrors(withAskLog({ mode: 'syslog' })).some((e) => e.includes('只能是')));
  assert.ok(askLogErrors(withAskLog({ mode: 'mock', retentionDays: Number('abc') })).some((e) => e.includes('正整數')));
  assert.deepEqual(askLogErrors(withAskLog({ mode: 'post', endpoint: 'https://logs.cdc.gov.tw/ask', retentionDays: 30 })), []);
  // post 未生效（端點不合格）時退回 mock，但建置會先被上面的錯誤擋下
  assert.equal(askLogSetting(withAskLog({ mode: 'post', endpoint: 'http://x.example' })).active, 'mock');
  assert.equal(askLogSetting(withAskLog({ mode: 'off' })).active, 'off');
});

test('CSP：只有生效中的 post 端點來源加進 connect-src，不加進 form-action；mock／off 不多開任何來源', () => {
  const base = securityHeaders({ hashes: [], askLogOrigins: [] })['Content-Security-Policy'];
  const live = withAskLog({ mode: 'post', endpoint: 'https://logs.cdc.gov.tw/v1/ask-log' });
  assert.deepEqual(askLogOrigins(live), ['https://logs.cdc.gov.tw']);
  assert.deepEqual(askLogOrigins(withAskLog({ mode: 'mock' })), []);
  const csp = securityHeaders({ hashes: [], askLogOrigins: askLogOrigins(live) })['Content-Security-Policy'];
  assert.match(csp, /connect-src 'self' https:\/\/api\.anthropic\.com https:\/\/logs\.cdc\.gov\.tw/);
  assert.doesNotMatch(csp.match(/form-action[^;]*/)[0], /logs\.cdc\.gov\.tw/);
  assert.doesNotMatch(base, /logs\.cdc\.gov\.tw/);
});

// ───────────────────────── (2) 前端 log.js ─────────────────────────
const sample = (over = {}) => ({
  query: '我的電話 0912-345-678 covid 要打幾劑',
  lang: 'zh-TW',
  view: 'public',
  intent: 'unknown',
  disease: null,
  relevance: 0,
  refused: true,
  refusal: { kind: 'no-match' },
  sources: [],
  retrieved: [],
  ...over,
});

test('log.js：事件只含約定欄位；問句再遮蔽、截 200 字；時間到分鐘；page 不含 ?q=；top 最多 3 個', () => {
  const ev = askLogEvent(sample({ query: `A123456789 ${'字'.repeat(300)}` }), {
    page: '/ask/?q=秘密#x',
    now: new Date('2026-10-11T03:04:59.999Z'),
    ev: '2026-10-11+abc1234',
  });
  assert.deepEqual(
    Object.keys(ev).sort(),
    ['disease', 'ev', 'intent', 'lang', 'outcome', 'page', 'q', 'refusalKind', 'relevance', 't', 'top', 'v', 'view'].sort(),
  );
  assert.ok(!ev.q.includes('A123456789'), '身分證字號已遮蔽');
  assert.ok(ev.q.length <= 200);
  assert.equal(ev.t, '2026-10-11T03:04Z');
  assert.equal(ev.page, '/ask/');
  assert.equal(ev.outcome, 'no-match');
  const ok = askLogEvent(
    sample({
      refused: false,
      refusal: null,
      relevance: 0.876,
      sources: [{ id: 'a', contentId: 'faq.a' }, { id: 'b', contentId: 'faq.a' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    }),
  );
  assert.equal(ok.outcome, 'answered');
  assert.equal(ok.relevance, 0.88);
  assert.deepEqual(ok.top, ['faq.a', 'c', 'd']);
  assert.equal(askLogEvent(sample({ query: '   ' })), null, '空問句不送');
  assert.equal(outcomeOf({ paused: true }), 'paused');
  assert.equal(outcomeOf({ refused: true, refusal: { kind: 'no-source' } }), 'no-source');
  assert.equal(outcomeOf({ refused: true, refusal: { kind: 'privacy' } }), 'refused');
  assert.equal(outcomeOf({ stats: {} }), 'stats');
  assert.equal(outcomeOf({ relevance: 0.1 }), 'low-relevance');
});

function fakeEnv({ hostname = 'localhost', dnt, gpc, fetchOk = true, cookie = 'x=1; cdc_ask_log_mock=1' } = {}) {
  const calls = [];
  return {
    calls,
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc, sendBeacon: (u, b) => (calls.push({ beacon: u, b }), true) },
    location: { hostname, pathname: '/new_cdc_prototype/ask/' },
    document: { cookie, documentElement: { dataset: { base: '/new_cdc_prototype' } } },
    fetch: fetchOk ? (u, o) => (calls.push({ url: u, opts: o }), Promise.resolve({ ok: true })) : undefined,
  };
}

test('log.js：DNT／GPC、off、mock 不在本機 ⇒ 不送；mock 在本機送同源 /api/ask-log；post 送 https 端點；不帶 referrer 與 cookie', () => {
  assert.equal(privacyOptOut({ doNotTrack: '1' }), true);
  assert.equal(privacyOptOut({ globalPrivacyControl: true }), true);
  for (const env of [fakeEnv({ dnt: '1' }), fakeEnv({ gpc: true })]) {
    assert.equal(sendAskLog(sample(), { askLog: 'mock' }, env), false);
    assert.equal(env.calls.length, 0);
  }
  const off = fakeEnv();
  assert.equal(sendAskLog(sample(), { askLog: 'off' }, off), false);
  const pages = fakeEnv({ hostname: 'ancientsky.github.io' });
  assert.equal(sendAskLog(sample(), { askLog: 'mock' }, pages), false, 'GitHub Pages 原型站不送民眾問句給託管平台');
  assert.equal(pages.calls.length, 0);
  const plain = fakeEnv({ cookie: '' });
  assert.equal(sendAskLog(sample(), { askLog: 'mock' }, plain), false, '本機但不是 serve.mjs（沒有模擬後端標記 cookie）⇒ 不送，不打必定 404 的請求');
  assert.equal(plain.calls.length, 0);

  const local = fakeEnv();
  assert.equal(sendAskLog(sample(), { askLog: 'mock', askLogEv: 'v' }, local), true);
  const c = local.calls[0];
  assert.equal(c.url, '/new_cdc_prototype/api/ask-log');
  assert.equal(c.opts.method, 'POST');
  assert.equal(c.opts.keepalive, true);
  assert.equal(c.opts.credentials, 'omit');
  assert.equal(c.opts.referrerPolicy, 'no-referrer');
  assert.equal(c.opts.mode, 'same-origin');
  const body = JSON.parse(c.opts.body);
  assert.ok(!body.q.includes('0912'), '手機號碼已遮蔽');
  assert.equal(body.page, '/new_cdc_prototype/ask/');
  assert.equal(body.ev, 'v');

  const prod = fakeEnv({ hostname: 'www.cdc.gov.tw' });
  assert.equal(sendAskLog(sample(), { askLog: 'post', askLogEndpoint: 'https://logs.cdc.gov.tw/ask' }, prod), true);
  assert.equal(prod.calls[0].url, 'https://logs.cdc.gov.tw/ask');
  assert.equal(prod.calls[0].opts.mode, 'no-cors');
  assert.equal(sendAskLog(sample(), { askLog: 'post', askLogEndpoint: 'http://logs.example.com' }, fakeEnv()), false, '非 https 端點不送');
  // 沒有 fetch 時：跨網域 post 才退回 sendBeacon（同網域的 beacon 會帶完整網址當 Referer）
  const old = fakeEnv({ fetchOk: false });
  assert.equal(sendAskLog(sample(), { askLog: 'mock' }, old), false);
  assert.equal(sendAskLog(sample(), { askLog: 'post', askLogEndpoint: 'https://logs.cdc.gov.tw/ask' }, old), true);
  assert.equal(old.calls[0].beacon, 'https://logs.cdc.gov.tw/ask');
  // 任何例外都靜默
  assert.equal(
    sendAskLog(
      sample(),
      { askLog: 'mock' },
      {
        ...fakeEnv(),
        fetch: () => {
          throw new Error('x');
        },
      },
    ),
    false,
  );
});

test('log.js：用真的引擎答一題查無與一題有答案，事件結果類型正確', () => {
  const site = loadSite(config);
  site.today = '2026-10-11';
  applyGovernance(site);
  site.searchIndex = buildSearchIndex(site);
  applyConsistency(site);
  const engine = engineFromSite(site);
  const miss = askLogEvent(engine.answer('量子電腦的散熱設計怎麼做', { lang: 'zh-TW' }), { page: '/ask/' });
  assert.equal(miss.outcome, 'no-match');
  assert.equal(miss.refusalKind, 'no-match');
  const hit = askLogEvent(engine.answer('登革熱的症狀有哪些', { lang: 'zh-TW' }), { page: '/ask/' });
  assert.ok(['answered', 'low-relevance'].includes(hit.outcome), hit.outcome);
  assert.equal(hit.disease, 'disease.dengue');
  assert.ok(hit.top.length >= 1);
  const pii = askLogEvent(engine.answer('我叫王小明 電話0912345678 登革熱怎麼辦', { lang: 'zh-TW' }));
  assert.doesNotMatch(pii.q, /王小明|0912345678/);
});

// ───────────────────────── (3) 模擬後端 ─────────────────────────
function fakeReq({ method = 'POST', body = '', headers = {}, ip = '127.0.0.1' } = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method;
  r.headers = { host: 'localhost:4173', 'content-type': 'text/plain;charset=UTF-8', ...headers };
  r.socket = { remoteAddress: ip };
  return r;
}
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v);
  res.end = (b = '') => (res.body = String(b));
  return res;
}
async function call(api, pathname, opts, search = '') {
  const res = fakeRes();
  const handled = await api.handle(fakeReq(opts), res, pathname, new URLSearchParams(search));
  return { handled, ...res, json: () => JSON.parse(res.body) };
}

test('模擬後端：POST 驗證、白名單（丟未知欄位）、伺服器端再遮蔽手機與身分證、寫 NDJSON 日檔、回 204', async () => {
  const dir = tmp('mock');
  const now = () => new Date('2026-10-11T02:03:44Z');
  const api = createAskLogApi({ dir, now, retentionDays: 90 });
  const body = JSON.stringify({
    v: 1,
    q: '  我的手機 0912345678，身分證 A123456789，covid?  ',
    lang: 'zh-TW',
    view: 'public',
    outcome: 'no-match',
    refusalKind: 'no-match',
    intent: 'unknown',
    disease: null,
    relevance: 0.123,
    top: ['faq.a', '<script>', 'b', 'c', 'd'],
    page: '/ask/?q=x',
    t: '1999-01-01T00:00Z',
    ev: '2026-10-11',
    ip: '1.2.3.4',
    ua: 'Mozilla',
    cookie: 'sid=1',
    email: 'x@y.z',
  });
  const r = await call(api, '/api/ask-log', { body, headers: { origin: 'http://localhost:4173' } });
  assert.equal(r.status ?? r.statusCode, 204);
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ['2026-10-11.ndjson']);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8').trim());
  assert.deepEqual(
    Object.keys(rec).sort(),
    ['v', 'q', 'lang', 'view', 'outcome', 'refusalKind', 'intent', 'disease', 'relevance', 'top', 'page', 'ev', 't'].sort(),
  );
  assert.doesNotMatch(rec.q, /0912345678|A123456789/);
  assert.match(rec.q, /\[電話\]/);
  assert.match(rec.q, /\[身分證\]/);
  assert.equal(rec.t, '2026-10-11T02:03Z', '用伺服器時間到分鐘，不採信前端 t');
  assert.equal(rec.page, '/ask/');
  assert.deepEqual(rec.top, ['faq.a', 'b', 'c']);
  assert.equal(rec.relevance, 0.12);
  // application/json 也收
  assert.equal((await call(api, '/api/ask-log', { body: JSON.stringify({ q: '流感' }), headers: { 'content-type': 'application/json' } })).statusCode, 204);
  // 沒有問句、壞 JSON、陣列 ⇒ 400
  assert.equal((await call(api, '/api/ask-log', { body: JSON.stringify({ q: '   ' }) })).statusCode, 400);
  assert.equal((await call(api, '/api/ask-log', { body: '{nope' })).json().error, 'bad_json');
  assert.equal((await call(api, '/api/ask-log', { body: '[1]' })).statusCode, 400);
  // 其他型別 ⇒ 415；GET ⇒ 405；跨站 Origin ⇒ 403
  assert.equal((await call(api, '/api/ask-log', { body: 'q=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode, 415);
  assert.equal((await call(api, '/api/ask-log', { method: 'GET' })).statusCode, 405);
  assert.equal((await call(api, '/api/ask-log', { body, headers: { origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await call(api, '/api/ask-log', { body, headers: { origin: 'null' } })).statusCode, 403);
  // 不是本模組的路徑 ⇒ 交給下一個處理者
  assert.equal((await call(api, '/api/health', { method: 'GET' })).handled, false);
  assert.ok(!fs.readFileSync(path.join(dir, files[0]), 'utf8').includes('Mozilla'));
});

test('模擬後端：本體超過 2 KB ⇒ 413；同一 IP 每分鐘超過上限 ⇒ 429＋Retry-After', async () => {
  const api = createAskLogApi({ dir: tmp('limit'), rate: { windowMs: 60_000, max: 2 } });
  const big = JSON.stringify({ q: 'x'.repeat(MAX_BODY + 10) });
  assert.equal((await call(api, '/api/ask-log', { body: big })).statusCode, 413);
  const ok = JSON.stringify({ q: '流感' });
  assert.equal((await call(api, '/api/ask-log', { body: ok, ip: '10.0.0.9' })).statusCode, 204);
  assert.equal((await call(api, '/api/ask-log', { body: ok, ip: '10.0.0.9' })).statusCode, 204);
  const r = await call(api, '/api/ask-log', { body: ok, ip: '10.0.0.9' });
  assert.equal(r.statusCode, 429);
  assert.equal(r.headers['retry-after'], '60');
  assert.equal((await call(api, '/api/ask-log', { body: ok, ip: '10.0.0.10' })).statusCode, 204, '別的 IP 不受影響');
});

test('模擬後端：報表端點只給本機（非本機 403、未知路徑 404、devReport 關閉 404）', async () => {
  const dir = tmp('dev');
  const api = createAskLogApi({ dir });
  assert.equal(api.cookie, 'cdc_ask_log_mock=1; Path=/; SameSite=Strict', 'serve.mjs 帶給前端的模擬後端標記');
  for (let i = 0; i < 3; i++) await call(api, '/api/ask-log', { body: JSON.stringify({ q: 'covid', outcome: 'no-match', lang: 'zh-TW' }) });
  assert.equal((await call(api, '/api/dev/ask-log/report', { method: 'GET', ip: '192.168.1.20' })).statusCode, 403);
  assert.equal((await call(api, '/api/dev/ask-log/report', { method: 'GET', ip: '::ffff:10.0.0.1' })).statusCode, 403);
  assert.equal((await call(api, '/api/dev/ask-log/raw', { method: 'GET' })).statusCode, 404);
  const r = await call(api, '/api/dev/ask-log/report', { method: 'GET', ip: '::1' });
  assert.equal(r.statusCode, 200);
  const rep = r.json();
  assert.equal(rep.totals.events, 3);
  assert.equal(rep.unanswered[0].q, 'covid');
  const off = createAskLogApi({ dir, devReport: false });
  assert.equal((await call(off, '/api/dev/ask-log/report', { method: 'GET' })).statusCode, 404);
});

test('模擬後端：保存期限——寫入時刪掉超過 retentionDays 天的日檔', async () => {
  const dir = tmp('retention');
  for (const d of ['2026-06-01', '2026-07-12', '2026-07-13', '2026-10-10']) fs.writeFileSync(path.join(dir, `${d}.ndjson`), '');
  fs.writeFileSync(path.join(dir, 'report.json'), '{}');
  const api = createAskLogApi({ dir, retentionDays: 90, now: () => new Date('2026-10-11T04:00:00Z') });
  assert.equal((await call(api, '/api/ask-log', { body: JSON.stringify({ q: '流感' }) })).statusCode, 204);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-07-13.ndjson', '2026-10-10.ndjson', '2026-10-11.ndjson', 'report.json']);
  assert.deepEqual(pruneOld(path.join(dir, 'nope'), 90), []);
  assert.equal(sanitizeEvent({ q: 1 }), null);
});

// ───────────────────────── (4) 報表 ─────────────────────────
function vocabDir() {
  const d = tmp('vocab');
  fs.mkdirSync(path.join(d, 'master'));
  fs.writeFileSync(
    path.join(d, 'master', 'glossary.json'),
    JSON.stringify([
      { id: 'term.covid-19', 'zh-TW': '新冠併發重症', aliases: ['新冠肺炎', 'COVID-19', '新冠'], en: 'COVID-19' },
      { id: 'term.dengue', 'zh-TW': '登革熱', en: 'Dengue fever' },
    ]),
  );
  fs.writeFileSync(path.join(d, 'master', 'diseases.json'), JSON.stringify([{ id: 'disease.mpox', name: 'M痘', nameEn: 'Mpox', aliases: ['猴痘'] }]));
  fs.writeFileSync(path.join(d, 'master', 'vaccines.json'), JSON.stringify([]));
  return d;
}

test('報表：問句正規化（全形、大小寫、空白、結尾標點）與編輯距離', () => {
  assert.equal(normalizeQuery('  ＣＯＶＩＤ？ '), 'covid');
  assert.equal(normalizeQuery('Covid   19 疫苗!!'), 'covid 19 疫苗');
  assert.equal(normalizeQuery('登革熱。'), '登革熱');
  assert.equal(editDistance('denge fever', 'dengue fever'), 1);
  assert.equal(editDistance('abc', 'xyzxyz', 2), 3);
});

test('報表：疑似同義詞候選——covid → COVID-19（新冠併發重症）；猴痘 → 主檔已有；拼錯的 denge fever → 登革熱；做愛 無候選', () => {
  const vocab = loadVocabulary(vocabDir());
  const c = synonymCandidates('covid', vocab);
  assert.equal(c[0].canon, '新冠併發重症');
  assert.equal(c[0].matched, 'COVID-19');
  assert.equal(c[0].how, 'prefix');
  assert.equal(synonymCandidates('猴痘', vocab)[0].how, 'exact');
  assert.equal(synonymCandidates('denge fever', vocab)[0].canon, '登革熱');
  assert.deepEqual(synonymCandidates('做愛', vocab), []);
  assert.deepEqual(synonymCandidates('a', vocab), [], '太短不比對');
  const tok = synonymCandidates('covid [電話] 要打幾劑', vocab);
  assert.equal(tok[0].matched, 'COVID-19', '整句比不到時改用句中的詞');
  assert.equal(tok[0].token, 'covid');
  // 真實主檔也找得到（不寫死比對方式：平行的同義詞工作可能已把 covid 加成別名）
  assert.ok(synonymCandidates('covid', loadVocabulary()).some((x) => /COVID-19/i.test(x.matched)));
});

test('報表：k-匿名門檻——次數或不同日子數達 K 才列出文字，未達只計數；依結果分表、語言統計', () => {
  const ev = (q, outcome, t, lang = 'zh-TW', extra = {}) => ({ v: 1, q, outcome, t, lang, d: t.slice(0, 10), ...extra });
  const events = [
    ev('covid', 'no-match', '2026-10-01T01:00Z'),
    ev('COVID?', 'no-match', '2026-10-02T01:00Z', 'en'),
    ev('Covid', 'no-match', '2026-10-02T02:00Z'),
    ev('罕見的個人狀況', 'no-match', '2026-10-03T01:00Z'), // 只問過一次 ⇒ 不列出
    ev('罕見的個人狀況', 'no-match', '2026-10-03T01:01Z'),
    ev('登革熱症狀', 'answered', '2026-10-01T01:00Z', 'zh-TW', { top: ['faq.dengue'] }),
    ev('登革熱症狀', 'answered', '2026-10-01T01:05Z', 'zh-TW', { top: ['faq.dengue'] }),
    ev('登革熱症狀', 'answered', '2026-10-01T01:09Z', 'zh-TW', { top: ['faq.dengue'] }),
    ev('流感', 'low-relevance', '2026-10-01T01:00Z'),
    ev('流感', 'low-relevance', '2026-10-04T01:00Z'),
    ev('流感', 'low-relevance', '2026-10-05T01:00Z'),
    ev('你是誰的人', 'refused', '2026-10-05T01:00Z', 'zh-TW', { refusalKind: 'opinion' }),
  ];
  const r = buildReport(events, { minCount: 3, vocab: loadVocabulary(vocabDir()), now: new Date('2026-10-11T00:00:00Z') });
  assert.equal(r.totals.events, 12);
  assert.equal(r.totals.byOutcome['no-match'], 5);
  assert.equal(r.totals.byLang.en, 1);
  assert.equal(r.totals.byRefusalKind.opinion, 1);
  assert.equal(r.unanswered.length, 1, '只有 covid 達門檻');
  assert.equal(r.unanswered[0].norm, 'covid');
  assert.equal(r.unanswered[0].count, 3);
  assert.equal(r.unanswered[0].days, 2);
  assert.equal(r.unanswered[0].candidates[0].matched, 'COVID-19');
  assert.equal(r.totals.hiddenQueries, 2, '罕見問句與單次拒答都不列出');
  assert.equal(r.totals.hiddenEvents, 3);
  assert.ok(!JSON.stringify(r).includes('罕見的個人狀況'), '低於門檻的文字完全不出現在報表');
  assert.ok(!JSON.stringify(r).includes('你是誰的人'));
  assert.equal(r.answered[0].q, '登革熱症狀');
  assert.deepEqual(r.answered[0].top, ['faq.dengue']);
  assert.equal(r.lowRelevance[0].q, '流感');
  assert.equal(r.range.from, '2026-10-01');
  assert.equal(r.llmPass.status, 'not-implemented');
  // K＝1 全部列出；K＝4 連 covid 都不列
  assert.equal(buildReport(events, { minCount: 1 }).unanswered.length, 2);
  assert.equal(buildReport(events, { minCount: 4 }).unanswered.length, 0);
  assert.match(formatReport(r), /疑似同義詞候選/);
});

test('報表：讀 NDJSON 日檔（略過壞行、依日期篩選），CLI 寫 report.json 到指定的 .local 外暫存目錄、拒絕寫進 repo 的 .local 以外', () => {
  const dir = tmp('cli');
  const line = (q, t, outcome = 'no-match') => JSON.stringify({ v: 1, q, outcome, t, lang: 'zh-TW' });
  fs.writeFileSync(path.join(dir, '2026-10-01.ndjson'), [line('covid', '2026-10-01T01:00Z'), '{壞掉', line('covid', '2026-10-01T02:00Z')].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '2026-10-02.ndjson'), `${line('covid', '2026-10-02T01:00Z')}\n`);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore');
  assert.equal(readEvents(dir).events.length, 3);
  assert.equal(readEvents(dir, { from: '2026-10-02' }).events.length, 1);
  assert.equal(reportFromDir(dir, { minCount: 3, contentDir: vocabDir() }).unanswered[0].q, 'covid');
  const out = path.join(dir, 'report.json');
  const stdout = execFileSync(process.execPath, ['scripts/ask-log-report.mjs', `--dir=${dir}`, `--out=${out}`, '--min=3'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(stdout, /答不出來的問題/);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).unanswered[0].norm, 'covid');
  assert.throws(() =>
    execFileSync(process.execPath, ['scripts/ask-log-report.mjs', `--dir=${dir}`, '--out=docs/ask-log-report.json'], { cwd: ROOT, stdio: 'pipe' }),
  );
  assert.ok(!fs.existsSync(path.join(ROOT, 'docs', 'ask-log-report.json')));
});

// ───────────────────────── (5) 模板、後台、建置產物、版控 ─────────────────────────
test('答案頁：.c-askpage 帶 data-ask-log 設定（預設 mock、post 帶端點、off）；ui.js 以 import() 載入 log.js（不進引擎靜態閉包）', () => {
  const site = loadSite(config);
  site.today = '2026-10-11';
  const html = (cfg) => String(ask.render(makeCtx({ ...site, config: cfg }, 'zh-TW', { path: '/ask/' })));
  assert.match(html(config), /data-ask-log="mock" data-ask-log-endpoint="" data-ask-log-ev="2026-10-11/);
  assert.match(
    html(withAskLog({ mode: 'post', endpoint: 'https://logs.cdc.gov.tw/ask' })),
    /data-ask-log="post" data-ask-log-endpoint="https:\/\/logs\.cdc\.gov\.tw\/ask"/,
  );
  assert.match(html(withAskLog({ mode: 'off' })), /data-ask-log="off" data-ask-log-endpoint=""/);
  const ui = fs.readFileSync(path.join(ROOT, 'src/client/answer/ui.js'), 'utf8');
  assert.match(ui, /import\('\.\/log\.js'\)/);
  const STATIC = /(?:^|[;\n}])\s*import\s*(?:[^'"()]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const f of ['ui.js', 'render.js', 'data.js', 'core.js']) {
    const deps = [...fs.readFileSync(path.join(ROOT, 'src/client/answer', f), 'utf8').matchAll(STATIC)].map((m) => m[1]);
    assert.ok(!deps.includes('./log.js'), `${f} 不得靜態 import log.js`);
  }
});

test('後台：/admin/ask-log/ 在導覽列、頁面不含任何紀錄內容（執行時才讀）、詞彙主檔接受 ?alias=&canon= 預填', () => {
  assert.ok(NAV.some((n) => n.key === 'ask-log' && n.href === '/admin/ask-log/'));
  assert.deepEqual(adminAskLog.meta().scripts, ['/assets/js/admin/ask-log.js']);
  const site = loadSite(config);
  const h = String(adminAskLog.render(makeCtx(site, 'zh-TW', { path: '/admin/ask-log/' })));
  assert.match(h, /id="al-file"/);
  assert.match(h, /答不出來的問題/);
  assert.doesNotMatch(h, /<script type="application\/json"/, '不在建置時嵌入紀錄');
  const client = fs.readFileSync(path.join(ROOT, 'src/client/admin/ask-log.js'), 'utf8');
  assert.match(client, /\/api\/dev\/ask-log\/report/);
  assert.match(client, /\/admin\/glossary\/\?\$\{sp\}#new-term/);
  const g = fs.readFileSync(path.join(ROOT, 'src/client/admin/glossary.js'), 'utf8');
  assert.match(g, /get\('alias'\)/);
  assert.match(g, /get\('canon'\)/);
});

test('建置產物（有 dist 時）：答案頁帶設定、log.js 已輸出、後台頁存在', { skip: !fs.existsSync(path.join(ROOT, 'dist', 'ask', 'index.html')) }, () => {
  const page = fs.readFileSync(path.join(ROOT, 'dist', 'ask', 'index.html'), 'utf8');
  assert.match(page, /data-ask-log="(mock|post|off)"/);
  assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'assets', 'js', 'answer', 'log.js')));
  assert.match(fs.readFileSync(path.join(ROOT, 'dist', 'assets', 'js', 'answer', 'ui.js'), 'utf8'), /import\(["']\.\/log\.js["']\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'admin', 'ask-log', 'index.html')));
});

test('版控：.local/ 在 .gitignore（查詢紀錄與報表只在 .local/ask-log/）', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^\.local\/$/m);
  const out = execFileSync('git', ['check-ignore', '.local/ask-log/2026-10-11.ndjson', '.local/ask-log/report.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(out.trim().split('\n').length, 2);
});
