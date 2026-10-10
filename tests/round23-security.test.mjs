// 第二十三輪（ARCHITECTURE §26）安全修正：原型模式 noindex／robots／橫幅、安全標頭產生器（CSP 雜湊）、快車道授權名單、BYOK 只在 sessionStorage 且限同事、Actions 固定 SHA 與 job 層權限。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../site.config.mjs';
import { ROOT } from '../scripts/lib/load.mjs';
import { layout, EARLY_JS } from '../src/templates/layout.mjs';
import { html } from '../scripts/lib/render.mjs';
import { t as T } from '../src/client/i18n.js';
import { inlineScripts, sha256, securityHeaders, renderNginx, renderWebConfig, renderNetlify } from '../scripts/lib/emit-headers.mjs';
import { buildPrototypeRobots } from '../scripts/lib/emit-seo.mjs';
import { laneForFiles, loadLanes, validateLanes, authorAllowed } from '../scripts/lib/lanes.mjs';
import * as LLM from '../src/client/answer/llm.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
function ctxOf(lang = 'zh-TW', p = '/') {
  const url = (x, o = {}) => `${config.basePath}${o.noLang || lang === 'zh-TW' ? '' : config.langs.find((l) => l.code === lang).path}${x}`;
  return { lang, path: p, url, t: (k, v) => T(lang, k, v), fmtDate: (d) => d, site: { today: '2026-10-01' }, alternates: ['zh-TW', 'en'] };
}
const page = (lang = 'zh-TW') => String(layout(ctxOf(lang), { title: 'x', description: 'y', body: html`<p>hi</p>` }));

// ───────── 26.1 原型模式 ─────────
test('站台模式：預設 prototype；每頁 noindex,nofollow；每頁頂端有七語「非官方原型」橫幅並連到正式官網', () => {
  assert.equal(config.mode, 'prototype'); assert.equal(config.isPrototype, true);
  for (const l of config.langs) {
    const h = page(l.code);
    assert.match(h, /<meta name="robots" content="noindex, nofollow">/, l.code);
    assert.match(h, /class="c-proto-banner" role="region" aria-label="[^"]*" data-proto-banner/, l.code);
    assert.ok(h.includes(T(l.code, 'proto.banner.tag')) && h.includes(T(l.code, 'proto.banner.text')), `${l.code} 橫幅文字`);
    assert.ok(h.includes(`href="${config.officialUrl}"`), '導向正式官網');
    // 橫幅在 skip-link 之後、topbar 之前（讀屏第一個聽到的是跳到主要內容，再來是原型聲明）
    assert.ok(h.indexOf('skip-link') < h.indexOf('c-proto-banner') && h.indexOf('c-proto-banner') < h.indexOf('class="topbar"'));
  }
  const r = buildPrototypeRobots();
  assert.match(r, /^User-agent: \*$/m); assert.match(r, /^Disallow: \/$/m); assert.ok(!/Allow:/.test(r)); assert.ok(!/Sitemap:/.test(r), '原型 robots 不列 sitemap');
  // 建置輸出（若已建置）：robots.txt 全擋、robots.production.txt 是政策版
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(path.join(dist, 'robots.txt'))) {
    assert.match(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8'), /^Disallow: \/$/m);
    assert.match(fs.readFileSync(path.join(dist, 'robots.production.txt'), 'utf8'), /GPTBot/);
  }
  assert.ok(read('site.config.mjs').includes("process.env.SITE_MODE === 'production'"), '正式站以 SITE_MODE=production 建置');
});

// ───────── 26.2 安全標頭 ─────────
test('inline script 掃描：只算會執行的 inline script（略過 src=、ld+json、application/json）；雜湊格式為 CSP sha256', () => {
  const h = `<script type="application/ld+json">{"a":1}</script><script src="/a.js"></script><script>alert(1)</script><script type="application/json" id="d">{"b":2}</script><script type="module">import x from './x.js'</script>`;
  const got = inlineScripts(h);
  assert.deepEqual(got, ['alert(1)', "import x from './x.js'"]);
  assert.equal(sha256('alert(1)'), `'sha256-${crypto.createHash('sha256').update('alert(1)').digest('base64')}'`);
  // layout 的檢視切換 inline script 一定在雜湊內
  assert.ok(inlineScripts(page()).includes(EARLY_JS));
});

test('安全標頭基準：CSP（self＋雜湊、frame-src 只有 vaxmap 與 YouTube、frame-ancestors self、object-src none）、HSTS、nosniff、Referrer、Permissions；三種伺服器格式都含全部標頭', () => {
  const H = securityHeaders({ hashes: [sha256(EARLY_JS)] });
  const csp = H['Content-Security-Policy'];
  assert.match(csp, /default-src 'self'/); assert.ok(csp.includes(`script-src 'self' ${sha256(EARLY_JS)}`)); assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
  assert.match(csp, /frame-src https:\/\/ancientsky\.github\.io https:\/\/www\.youtube-nocookie\.com https:\/\/www\.youtube\.com/);
  assert.match(csp, /frame-ancestors 'self'/); assert.match(csp, /object-src 'none'/); assert.match(csp, /base-uri 'self'/); assert.match(csp, /connect-src 'self' https:\/\/api\.anthropic\.com/);
  assert.equal(H['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains');
  assert.equal(H['X-Content-Type-Options'], 'nosniff'); assert.equal(H['Referrer-Policy'], 'strict-origin-when-cross-origin'); assert.match(H['Permissions-Policy'], /camera=\(\)/);
  for (const txt of [renderNginx(H), renderWebConfig(H), renderNetlify(H)]) for (const k of Object.keys(H)) assert.ok(txt.includes(k), `${k} in output`);
  assert.match(renderNginx(H), /add_header Content-Security-Policy ".*" always;/);
  assert.match(renderWebConfig(H), /<add name="Content-Security-Policy" value=".*'self'.*" \/>/);
  // 建置輸出（若已建置）：dist/headers/ 五個檔、headers.json 的 CSP 含 layout 雜湊
  const hj = path.join(ROOT, 'dist/headers/headers.json');
  if (fs.existsSync(hj)) {
    const j = JSON.parse(fs.readFileSync(hj, 'utf8'));
    assert.ok(j.headers['Content-Security-Policy'].includes(sha256(EARLY_JS)));
    assert.ok(j.inlineScripts > 0 && j.inlineScripts <= 40, `inline script 段數 ${j.inlineScripts}`);
    for (const f of ['nginx.conf', 'web.config.headers.xml', '_headers', 'README.md']) assert.ok(fs.existsSync(path.join(ROOT, 'dist/headers', f)), f);
  }
});

// ───────── 26.3 快車道授權名單 ─────────
test('lanes.json：自動合併車道必有 allowedAuthors；validateLanes 擋缺名單；authorAllowed 支援帳號（不分大小寫）與 team:org/slug', () => {
  const cfg = loadLanes();
  assert.ok(cfg.lanes.fast.allowedAuthors.length && cfg.lanes.emergency.allowedAuthors.length);
  assert.ok(Array.isArray(cfg.rules.urgentAllowedAuthors) && cfg.rules.urgentAllowedAuthors.length);
  assert.deepEqual(validateLanes(cfg), []);
  const broken = structuredClone(cfg); delete broken.lanes.fast.allowedAuthors;
  assert.ok(validateLanes(broken).some((e) => e.includes('allowedAuthors')));
  assert.equal(authorAllowed('ancientsky', ['ancientsky']).allowed, true);
  assert.equal(authorAllowed('AncientSky', ['ancientsky']).allowed, true);
  assert.equal(authorAllowed('someone', ['ancientsky']).allowed, false);
  assert.equal(authorAllowed('someone', ['team:cdc/web-pr'], { teams: ['cdc/web-pr'] }).allowed, true);
  assert.equal(authorAllowed('someone', ['team:cdc/web-pr'], { teams: [] }).allowed, false);
  assert.equal(authorAllowed(null, ['ancientsky']).allowed, false);
});

test('laneForFiles：作者不在名單 ⇒ 快車道／緊急發布降為一般車道（需 1 位核准），authorGate 說明理由；在名單內維持自動合併；沒傳作者視同不在名單', () => {
  const since = '2026-10-05T01:00:00Z';
  const ok = laneForFiles(['content/news/x.json'], { since, author: 'ancientsky' });
  assert.equal(ok.lane, 'fast'); assert.equal(ok.autoMerge, true); assert.equal(ok.authorGate.allowed, true);
  const no = laneForFiles(['content/news/x.json'], { since, author: 'intruder' });
  assert.equal(no.lane, 'standard'); assert.equal(no.autoMerge, false); assert.equal(no.requiredApprovals, 1);
  assert.equal(no.authorGate.allowed, false); assert.equal(no.authorGate.requestedLane, 'fast'); assert.ok(no.reasons.some((r) => r.includes('不在授權名單') && r.includes('降為一般車道')));
  assert.deepEqual(no.files.map((f) => f.lane), ['fast'], '檔案本身的分類不變，只是整體車道降級');
  const none = laneForFiles(['content/situation/current.json'], { since });
  assert.equal(none.lane, 'standard'); assert.equal(none.authorGate.allowed, false);
  const std = laneForFiles(['content/diseases/dengue.json'], { since, author: 'intruder' });
  assert.equal(std.lane, 'standard'); assert.equal(std.authorGate, null, '本來就需人審的車道不看名單');
  // CI 把 PR 作者傳進去
  const wf = read('.github/workflows/content-pr.yml');
  assert.ok(wf.includes('PR_AUTHOR: ${{ github.event.pull_request.user.login }}') && wf.includes('--author="$PR_AUTHOR"') && wf.includes('作者授權'));
});

// ───────── 26.4 BYOK ─────────
test('BYOK：金鑰只進 sessionStorage，載入時清掉舊 localStorage 金鑰；沒有後台工作階段就不顯示金鑰欄位；模型名稱由頁面 data 屬性帶入', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  const ss = mem(), ls = mem();
  ls.setItem('cdc.llmKey', 'sk-ant-legacy');
  const g = globalThis; const o = { ss: g.sessionStorage, ls: g.localStorage, doc: g.document };
  try {
    Object.defineProperty(g, 'sessionStorage', { value: ss, configurable: true, writable: true });
    Object.defineProperty(g, 'localStorage', { value: ls, configurable: true, writable: true });
    LLM.purgeLegacyKey(); assert.equal(ls.getItem('cdc.llmKey'), null, '舊 localStorage 金鑰被清掉');
    LLM.setKey('sk-ant-x'); assert.equal(ss.getItem('cdc.llmKey'), 'sk-ant-x'); assert.equal(ls.getItem('cdc.llmKey'), null, '不寫 localStorage');
    assert.equal(LLM.getKey(), 'sk-ant-x'); LLM.clearKey(); assert.equal(LLM.hasKey(), false);
    assert.equal(LLM.staffSessionActive(), false);
    ls.setItem('cdc.admin.session', JSON.stringify({ unit: 'unit.pr', roles: ['editor'], exp: Date.now() + 60000 }));
    assert.equal(LLM.staffSessionActive(), true);
    ls.setItem('cdc.admin.session', JSON.stringify({ unit: 'unit.pr', roles: ['editor'], exp: Date.now() - 1 }));
    assert.equal(LLM.staffSessionActive(), false, '過期不算');
    // 模型由 #ask-advanced 的 data 屬性帶入
    Object.defineProperty(g, 'document', { value: { getElementById: (id) => (id === 'ask-advanced' ? { dataset: { llmModel: 'm-default', llmModels: 'm-default,m-big' } } : null) }, configurable: true, writable: true });
    assert.equal(LLM.llmDefaultModel(), 'm-default'); assert.deepEqual(LLM.llmModels(), ['m-default', 'm-big']); assert.equal(LLM.getModel(), 'm-default');
  } finally {
    for (const [k, v] of [['sessionStorage', o.ss], ['localStorage', o.ls], ['document', o.doc]]) { if (v === undefined) delete g[k]; else Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); }
  }
  const ask = read('src/templates/public/ask.mjs');
  assert.ok(ask.includes('data-llm-model="${ai.llmModel}"') && ask.includes('<div data-llm-staff hidden>'), '金鑰欄位預設隱藏，由 ui.js 在同事登入時顯示');
  const ui = read('src/client/answer/ui.js');
  assert.ok(ui.includes('staffSessionActive()') && ui.includes('purgeLegacyKey()') && !/localStorage\.(get|set)Item\(LLM_ON_KEY/.test(ui));
  assert.ok(!/ls\(\)\?\.setItem\(KEY_STORE/.test(read('src/client/answer/llm.js')));
  assert.ok(!/store\.raw\('cdc\.llmKey'\)/.test(read('src/client/admin/publish.js')), '後台多語初稿也改讀 sessionStorage');
});

// ───────── 26.5 GitHub Actions ─────────
test('workflows：第三方 action 全部固定 40 字元 SHA 並註解版本；工作流程層級只有 contents: read，寫入權限在 job 層；有 dependabot.yml', () => {
  for (const f of fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((x) => x.endsWith('.yml'))) {
    const txt = read(`.github/workflows/${f}`);
    for (const m of txt.matchAll(/uses:\s*([^\s#]+)(.*)/g)) {
      assert.match(m[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${f}: ${m[1]} 要固定 commit SHA`);
      assert.match(m[2], /#\s*v\d/, `${f}: ${m[1]} 要註解版本號`);
    }
  }
  for (const f of ['content-pr.yml', 'pages.yml']) {
    const txt = read(`.github/workflows/${f}`);
    const top = txt.split(/\njobs:\n/)[0];
    assert.match(top, /permissions:\n  contents: read\n/, `${f} 工作流程層級唯讀`);
    assert.ok(!/^  (pull-requests|issues|actions|pages|id-token): write/m.test(top), `${f} 工作流程層級不給寫入`);
  }
  assert.match(read('.github/workflows/pages.yml'), /deploy:\n[\s\S]*?permissions:\n\s+pages: write\n\s+id-token: write/);
  const dep = read('.github/dependabot.yml');
  assert.ok(dep.includes('package-ecosystem: github-actions') && dep.includes('package-ecosystem: npm'));
});
