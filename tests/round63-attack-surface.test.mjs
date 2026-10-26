// 第六十三輪（Issue #141）：縮小可被自動盤點的攻擊面——部署產物白名單、內部站拆分、ADMIN_ORIGIN、指紋標頭。
import './pin-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../site.config.mjs';
import { ROOT } from '../scripts/lib/load.mjs';
import { auditDist, splitForProduction, globToRegExp, matchRule, cspOrigins, adminOriginErrors, FORBIDDEN_PUBLIC } from '../scripts/lib/dist-profile.mjs';
import { securityHeaders, renderNginx, renderWebConfig, renderNetlify, renderReadme, emitHeaders, REMOVE_HEADERS } from '../scripts/lib/emit-headers.mjs';
import { makeUrl, html } from '../scripts/lib/render.mjs';
import { govern } from './helpers.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { layout } from '../src/templates/layout.mjs';
import { pageData } from '../src/templates/public/_partials.mjs';

/** 建一個假 dist：公開頁、v1、assets（含 source map 與 sourceMappingURL）、後台、標頭、預覽、robots.production.txt */
function fixture(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r62-dist-'));
  const files = {
    'index.html': '<!doctype html><title>x</title>',
    'diseases/dengue/index.html': '<p>dengue</p>',
    'v1/index.json': '{}',
    'v1/diseases/dengue.json': '{}',
    'assets/styles/base.css': 'body{}',
    'assets/js/ui.js': 'console.log(1);\n//# sourceMappingURL=ui.js.map\n',
    'assets/js/ui.js.map': '{"version":3}',
    'assets/js/globals.d.ts': 'declare const CDC: any;',
    'assets/js/admin/common.js': 'export {};\n//# sourceMappingURL=common.js.map\n',
    'assets/js/admin/common.js.map': '{}',
    'admin/index.html': '<p>admin</p>',
    'admin/publish/index.html': '<p>publish</p>',
    'vendor/marked.min.js': '/* marked */',
    'headers/headers.json': JSON.stringify({ headers: securityHeaders({}), remove: REMOVE_HEADERS }),
    'headers/nginx.conf': 'server_tokens off;',
    'redirects/nginx.map': '/old /new;',
    'redirects/_redirects': '/old /new 301',
    'robots.production.txt': 'User-agent: *',
    'robots.txt': 'User-agent: *',
    'preview/pr-7/index.html': '<p>preview</p>',
    'preview/pr-7/admin/index.html': '<p>preview admin</p>',
    '.nojekyll': '',
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('globToRegExp：**/ 含零層、結尾 /** 含目錄本身底下全部、* 不跨 /', () => {
  assert.ok(globToRegExp('**/*.map').test('a.map'));
  assert.ok(globToRegExp('**/*.map').test('assets/js/a.js.map'));
  assert.ok(globToRegExp('admin/**').test('admin/publish/index.html'));
  assert.ok(!globToRegExp('admin/**').test('administration/index.html'));
  assert.ok(!globToRegExp('assets/*.css').test('assets/styles/base.css'));
  assert.ok(globToRegExp('**/.git*/**').test('preview/pr-1/.git/config'));
  assert.equal(matchRule('redirects/nginx.map'), null, 'nginx map 檔是公開的舊網址對照，不是 source map');
  assert.equal(matchRule('assets/js/ui.js.map')?.pattern, '**/*.map');
  // 每條規則都要有理由
  for (const r of FORBIDDEN_PUBLIC) assert.ok(r.reason && r.reason.length > 4, r.pattern);
  for (const p of [
    'admin/**',
    'assets/js/admin/**',
    '**/*.map',
    'headers/**',
    'preview/**',
    'assets/js/globals.d.ts',
    'robots.production.txt',
    '**/.env*',
    '**/node_modules/**',
    'tests/**',
    'docs/**',
    '**/*.bak',
    '**/*.orig',
    '**/*.swp',
    '**/*.log',
    '**/.DS_Store',
    '**/Thumbs.db',
    '.local/**',
  ])
    assert.ok(
      FORBIDDEN_PUBLIC.some((r) => r.pattern === p),
      p,
    );
});

test('auditDist public：原型限定路徑全部報 forbidden 並帶規則與理由；公開檔不報', () => {
  const dir = fixture();
  const r = auditDist(dir, { profile: 'public' });
  assert.equal(r.ok, false);
  const by = Object.fromEntries(r.forbidden.map((f) => [f.path, f.rule]));
  assert.equal(by['admin/index.html'], 'admin/**');
  assert.equal(by['assets/js/admin/common.js'], 'assets/js/admin/**');
  assert.equal(by['assets/js/ui.js.map'], '**/*.map');
  assert.equal(by['headers/nginx.conf'], 'headers/**');
  assert.equal(by['preview/pr-7/admin/index.html'], 'preview/**', '預覽底下的後台算預覽規則');
  assert.equal(by['assets/js/globals.d.ts'], 'assets/js/globals.d.ts');
  assert.equal(by['robots.production.txt'], 'robots.production.txt');
  assert.equal(by['vendor/marked.min.js'], 'vendor/**');
  for (const ok of ['index.html', 'v1/index.json', 'assets/js/ui.js', 'redirects/nginx.map', 'redirects/_redirects', 'robots.txt', '.nojekyll'])
    assert.ok(!(ok in by), ok);
  assert.ok(r.forbidden.every((f) => f.reason));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('auditDist prototype：後台等報 expected（不算失敗）；防禦性規則與副檔名白名單照擋', () => {
  const dir = fixture();
  const clean = auditDist(dir, { profile: 'prototype' });
  assert.equal(clean.ok, true, JSON.stringify(clean.forbidden));
  const exp = Object.fromEntries(clean.expected.map((e) => [e.rule, e.count]));
  assert.equal(exp['admin/**'], 2);
  assert.equal(exp['**/*.map'], 1); // assets/js/admin/common.js.map 歸 assets/js/admin/**
  assert.ok(exp['preview/**'] >= 2 && exp['headers/**'] === 2);
  fs.rmSync(dir, { recursive: true, force: true });

  const bad = fixture({
    '.env': 'TOKEN=x',
    'preview/pr-7/.env.local': 'x',
    'docs/deploy.md': '#',
    'files/a/report.bak': 'x',
    '.local/ask-log/x.jsonl': '{}',
    'node_modules/x/index.js': '',
    'assets/.DS_Store': '',
    'dump.sql': 'x',
    'debug.log': 'x',
    '.git/HEAD': 'ref',
  });
  const r = auditDist(bad, { profile: 'prototype' });
  assert.equal(r.ok, false);
  const by = Object.fromEntries(r.forbidden.map((f) => [f.path, f.rule]));
  assert.equal(by['.env'], '**/.env*');
  assert.equal(by['preview/pr-7/.env.local'], '**/.env*', '防禦性規則先於 preview 規則');
  assert.equal(by['docs/deploy.md'], 'docs/**');
  assert.equal(by['files/a/report.bak'], '**/*.bak');
  assert.ok(by['.local/ask-log/x.jsonl'].includes('.local'));
  assert.equal(by['node_modules/x/index.js'], '**/node_modules/**');
  assert.equal(by['assets/.DS_Store'], '**/.DS_Store');
  assert.equal(by['dump.sql'], 'allowlist:extension', '規則清單不知道的副檔名由白名單擋下');
  assert.equal(by['debug.log'], '**/*.log');
  assert.ok(by['.git/HEAD'].startsWith('**/.git'));
  fs.rmSync(bad, { recursive: true, force: true });
});

test('inventory：頁數、v1 JSON、後台頁、動態端點（含生效模式）、CSP 的外部來源', () => {
  const dir = fixture();
  const { inventory: inv } = auditDist(dir, { profile: 'prototype' });
  assert.equal(inv.counts.html, 6); // 含預覽的 2 頁
  assert.deepEqual(inv.api.v1Json, ['/v1/diseases/dengue.json', '/v1/index.json']);
  assert.deepEqual(inv.adminPages, ['/admin/', '/admin/publish/']);
  assert.ok(inv.counts.byTopDir['admin/'].files === 2);
  const ep = Object.fromEntries(inv.endpoints.map((e) => [e.path, e]));
  for (const p of ['/api/gateway/*', '/api/ask-log', '/api/intl-epidemic', '/api/subscriptions*', 'forms.careersApply', 'forms.directorMailbox'])
    assert.ok(ep[p], p);
  assert.equal(ep['/api/gateway/*'].exposure, 'internal');
  assert.equal(ep['/api/ask-log'].mode, 'mock');
  assert.equal(ep['forms.careersApply'].mode, 'mock');
  const origins = inv.externalOrigins.map((o) => o.origin);
  for (const o of ['https://api.anthropic.com', 'https://www.youtube-nocookie.com', 'https://i.ytimg.com', new URL(config.vaxmapUrl).origin])
    assert.ok(origins.includes(o), o);
  assert.equal(inv.cspSource, 'headers/headers.json');
  assert.ok(inv.externalOrigins.find((o) => o.origin === 'https://api.anthropic.com').purpose.includes('BYOK'));
  // 表單改為 post ⇒ 端點與來源進清冊
  const cfg = { ...config, forms: { ...config.forms, careersApply: { endpoint: 'https://forms.example.gov.tw/apply', mode: 'post' } } };
  const inv2 = auditDist(dir, { profile: 'prototype', cfg }).inventory;
  const ca = inv2.endpoints.find((e) => e.path === 'forms.careersApply');
  assert.equal(ca.mode, 'post');
  assert.equal(ca.endpoint, 'https://forms.example.gov.tw/apply');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cspOrigins：只取 https 來源並記下指令', () => {
  const o = cspOrigins("default-src 'self'; frame-src https://a.example https://b.example; connect-src 'self' https://a.example");
  assert.deepEqual(o, [
    { origin: 'https://a.example', directives: ['frame-src', 'connect-src'] },
    { origin: 'https://b.example', directives: ['frame-src'] },
  ]);
});

test('splitForProduction：公開樹乾淨；內部站有 admin、assets、v1、vendor、headers、README、exposure.json', () => {
  const dir = fixture();
  const internal = fs.mkdtempSync(path.join(os.tmpdir(), 'r62-internal-'));
  fs.writeFileSync(path.join(internal, 'stale.txt'), '上一次的殘留');
  const r = splitForProduction(dir, internal);
  const after = auditDist(dir, { profile: 'public' });
  assert.equal(after.ok, true, JSON.stringify(after.forbidden));
  for (const gone of ['admin', 'assets/js/admin', 'headers', 'preview', 'vendor', 'robots.production.txt', 'assets/js/ui.js.map', 'assets/js/globals.d.ts'])
    assert.ok(!fs.existsSync(path.join(dir, gone)), gone);
  for (const kept of ['index.html', 'v1/index.json', 'assets/js/ui.js', 'redirects/nginx.map', 'robots.txt'])
    assert.ok(fs.existsSync(path.join(dir, kept)), kept);
  assert.ok(!fs.readFileSync(path.join(dir, 'assets/js/ui.js'), 'utf8').includes('sourceMappingURL'), '公開 JS 不再指向 source map');
  assert.ok(fs.readFileSync(path.join(dir, 'assets/js/ui.js'), 'utf8').startsWith('console.log(1);'));
  for (const f of [
    'admin/index.html',
    'admin/publish/index.html',
    'assets/js/admin/common.js',
    'assets/js/ui.js.map',
    'assets/js/globals.d.ts',
    'assets/styles/base.css',
    'v1/index.json',
    'vendor/marked.min.js',
    'headers/nginx.conf',
    'README.md',
    'exposure.json',
  ])
    assert.ok(fs.existsSync(path.join(internal, f)), f);
  assert.ok(fs.readFileSync(path.join(internal, 'assets/js/admin/common.js'), 'utf8').includes('sourceMappingURL'), '內部站保留 source map 註解');
  assert.ok(!fs.existsSync(path.join(internal, 'stale.txt')), '內部站目錄每次重建');
  assert.ok(!fs.existsSync(path.join(internal, 'preview')), '預覽不搬到內部站');
  const exp = JSON.parse(fs.readFileSync(path.join(internal, 'exposure.json'), 'utf8'));
  assert.deepEqual(exp.adminPages, ['/admin/', '/admin/publish/'], '清冊是拆分前的完整樣貌');
  const readme = fs.readFileSync(path.join(internal, 'README.md'), 'utf8');
  for (const s of ['反向代理', '/api/gateway/', 'VPN', '條件式存取', 'headers/', '不對網際網路開放'])
    assert.ok(readme.includes(s) || (s === '不對網際網路開放' && readme.includes('絕不對網際網路開放')), s);
  assert.equal(r.moved.admin, 2);
  assert.equal(r.deleted.robotsProduction, 1);
  assert.ok(r.strippedSourceMapComments >= 1);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(internal, { recursive: true, force: true });
});

test('audit-dist CLI：public 有禁止檔 exit 1、prototype exit 0、--json 可解析', () => {
  const dir = fixture();
  const cli = path.join(ROOT, 'scripts/audit-dist.mjs');
  const a = spawnSync(process.execPath, [cli, dir], { encoding: 'utf8' });
  assert.equal(a.status, 1, a.stdout + a.stderr);
  assert.match(a.stdout, /admin\/\*\*/);
  const b = spawnSync(process.execPath, [cli, dir, '--profile', 'prototype'], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  const c = spawnSync(process.execPath, [cli, dir, '--profile=public', '--json'], { encoding: 'utf8' });
  const j = JSON.parse(c.stdout);
  assert.equal(j.ok, false);
  assert.ok(j.inventory.endpoints.length >= 5);
  const d = spawnSync(process.execPath, [cli, dir, '--profile', 'nope'], { encoding: 'utf8' });
  assert.equal(d.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ADMIN_ORIGIN：未設定時後台連結為站內相對；設定後公開頁的後台連結改為內部站絕對網址', () => {
  const site = govern('2026-10-25');
  const item = site.all.find((i) => i.status === 'published' && i.type === 'faq');
  const render = () => {
    const ctx = makeCtx(site, 'zh-TW', { path: '/', alternates: ['zh-TW'] });
    return String(layout(ctx, { title: 'x', description: 'y', body: html`${pageData(ctx, item)}` }));
  };
  assert.equal(config.adminOrigin, '');
  const before = render();
  assert.ok(before.includes(`href="${config.basePath}/admin/"`));
  assert.ok(before.includes(`href="${config.basePath}/admin/publish/?edit=${encodeURIComponent(item.id)}"`));
  const saved = config.adminOrigin;
  config.adminOrigin = 'https://staff.example.gov.tw';
  try {
    const after = render();
    assert.ok(after.includes(`href="https://staff.example.gov.tw${config.basePath}/admin/"`));
    assert.ok(
      after.includes(`href="https://staff.example.gov.tw${config.basePath}/admin/publish/?edit=${encodeURIComponent(item.id)}"`),
      '頁尾「同事修改這頁」',
    );
    assert.ok(!after.includes(`href="${config.basePath}/admin/`), '沒有殘留的站內 /admin/ 連結');
    const u = makeUrl('en');
    assert.equal(u('/admin/', { noLang: true }), `https://staff.example.gov.tw${config.basePath}/admin/`);
    assert.ok(!u('/administration/').startsWith('https://'), '只比對 /admin 這一段');
    assert.ok(!u('/diseases/').startsWith('https://'));
  } finally {
    config.adminOrigin = saved;
  }
});

test('adminOriginErrors：只接受 https 網域（本機 http 例外），不能帶路徑', () => {
  assert.deepEqual(adminOriginErrors({ adminOrigin: '' }), []);
  assert.deepEqual(adminOriginErrors({ adminOrigin: 'https://staff.example.gov.tw' }), []);
  assert.deepEqual(adminOriginErrors({ adminOrigin: 'http://localhost:4174' }), []);
  assert.equal(adminOriginErrors({ adminOrigin: 'http://staff.example.gov.tw' }).length, 1);
  assert.equal(adminOriginErrors({ adminOrigin: 'https://staff.example.gov.tw/' }).length, 1);
  assert.equal(adminOriginErrors({ adminOrigin: 'https://staff.example.gov.tw/admin' }).length, 1);
  assert.equal(adminOriginErrors({ adminOrigin: 'not a url' }).length, 1);
});

test('指紋標頭：headers.json 有 remove 陣列（headers 形狀不變）；nginx、IIS、_headers、README 各自的做法', () => {
  assert.deepEqual(REMOVE_HEADERS, ['Server', 'X-Powered-By', 'X-AspNet-Version', 'X-AspNetMvc-Version']);
  const H = securityHeaders({ hashes: [] });
  const ng = renderNginx(H);
  assert.match(ng, /^server_tokens off;$/m);
  assert.match(ng, /more_clear_headers/);
  assert.match(ng, /^proxy_hide_header X-Powered-By;$/m);
  const wc = renderWebConfig(H);
  assert.ok(wc.includes('<remove name="X-Powered-By" />'));
  assert.ok(wc.includes('<security><requestFiltering removeServerHeader="true" /></security>'));
  assert.ok(
    wc.indexOf('<security>') > wc.indexOf('</httpProtocol>') && wc.indexOf('<security>') < wc.indexOf('</system.webServer>'),
    'security 在 system.webServer 內、httpProtocol 外',
  );
  assert.ok(!/<add name="(Server|X-Powered-By)"/.test(wc));
  const nf = renderNetlify(H);
  assert.match(nf, /^# .*不能拿掉/m);
  assert.ok(!/^\s+(Server|X-Powered-By):/m.test(nf));
  const rd = renderReadme(H, { pages: 1, count: 0, firstSeen: {} });
  for (const s of ['Azure Front Door', '刪除', 'more_clear_headers', 'removeServerHeader', ...REMOVE_HEADERS]) assert.ok(rd.includes(s), s);
  // emitHeaders 寫出的 headers.json
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r62-hdr-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script>1</script>');
  const out = new Map();
  emitHeaders(dir, (rel, body) => out.set(rel, body));
  const j = JSON.parse(out.get('headers/headers.json'));
  assert.ok(j.headers['Content-Security-Policy'].includes("'self'"));
  assert.deepEqual(j.remove, REMOVE_HEADERS);
  assert.ok(!('Server' in j.headers));
  fs.rmSync(dir, { recursive: true, force: true });
});

test(
  'dist（若已建置）：原型建置有 headers/exposure.json，正式建置的公開樹通過 public 稽核',
  { skip: !fs.existsSync(path.join(ROOT, 'dist/index.html')) },
  () => {
    const dist = path.join(ROOT, 'dist');
    const hj = path.join(dist, 'headers/headers.json');
    if (fs.existsSync(hj)) {
      // 原型建置
      const j = JSON.parse(fs.readFileSync(hj, 'utf8'));
      assert.deepEqual(j.remove, REMOVE_HEADERS);
      const exp = JSON.parse(fs.readFileSync(path.join(dist, 'headers/exposure.json'), 'utf8'));
      assert.ok(exp.adminPages.includes('/admin/publish/'));
      assert.ok(exp.externalOrigins.some((o) => o.origin === 'https://api.anthropic.com'));
      assert.equal(auditDist(dist, { profile: 'prototype' }).ok, true);
    } else {
      assert.equal(auditDist(dist, { profile: 'public' }).ok, true);
    }
  },
);
