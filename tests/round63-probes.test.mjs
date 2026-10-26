// 第六十三輪（Issue #140「防 AI 自動化攻擊探測」）：access log 的自動化探測偵測。
//   - 特徵清單是資料（scripts/lib/probe-signatures.mjs），SOC 告警與開發者工具看同一份
//   - 夾具 tests/fixtures/access-probe.log（文件用 IP 203.0.113.x／198.51.100.x）：正常民眾、開放資料介接（python-requests）不能被列出；
//     爆量列舉、特徵路徑、掃描器 UA 要列出；/admin/、/api/gateway/ 只有 --public 才算
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLog, detectProbes, timeOf, analyze, toMarkdown } from '../scripts/analyze-404-log.mjs';
import { PROBE_SIGNATURES, matchSignature, suspiciousUa } from '../scripts/lib/probe-signatures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/access-probe.log');
const { entries } = parseLog(fs.readFileSync(FIXTURE, 'utf8'));

test('特徵清單：該抓的都抓、本站正當路徑（含 /openapi.json、舊站網址、附件）都不抓', () => {
  const ids = new Set(PROBE_SIGNATURES.map((s) => s.id));
  assert.equal(ids.size, PROBE_SIGNATURES.length, 'id 不重複');
  for (const s of PROBE_SIGNATURES) assert.ok(s.label && s.re instanceof RegExp, s.id);
  const hit = {
    '/.env': 'env-file',
    '/app/.env.production': 'env-file',
    '/.git/config': 'git-dir',
    '/.svn/entries': 'svn-dir',
    '/wp-login.php': 'wp-login',
    '/wp-admin/install.php': 'wp-admin',
    '/xmlrpc.php': 'xmlrpc',
    '/phpmyadmin/': 'phpmyadmin',
    '/.aws/credentials': 'aws-credentials',
    '/server-status': 'server-status',
    '/actuator/env': 'actuator',
    '/cgi-bin/luci': 'cgi-bin',
    '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php': 'phpunit',
    '/static/../../etc/passwd': 'path-traversal',
    '/a/..%2f..%2fwin.ini': 'path-traversal',
    '/%2e%2e/%2e%2e/boot.ini': 'path-traversal',
    '/etc/passwd': 'etc-passwd',
    '/.DS_Store': 'ds-store',
    '/web.config': 'web-config',
    '/backup.zip': 'backup-file',
    '/www.tar.gz': 'backup-file',
    '/db.sql': 'backup-file',
    '/index.php.bak': 'backup-file',
    '/swagger-ui.html': 'api-docs',
    '/v2/api-docs': 'api-docs',
  };
  for (const [p, id] of Object.entries(hit)) assert.equal(matchSignature(p)?.id, id, p);
  for (const p of [
    '/',
    '/openapi.json',
    '/v1/diseases.json',
    '/diseases/dengue/',
    '/Uploads/archives/%E7%B5%90%E6%A0%B8.pdf',
    '/Disease/SubIndex/WYbKe3aE7LiY5gb-eA8PBw',
    '/assets/js/i18n.zh-TW.js',
    '/documents/files/guide.zip',
    '/en/subscribe/',
    '/data/environment/',
  ])
    assert.equal(matchSignature(p), null, `${p} 是本站的正當路徑`);
  assert.equal(matchSignature('/admin/'), null, '後台：預設（內網 log）不算');
  assert.equal(matchSignature('/admin/', { public: true })?.id, 'admin');
  assert.equal(matchSignature('/new_cdc_prototype/api/gateway/health', { public: true })?.id, 'gateway', '含 basePath');
});

test('User-Agent：掃描器與程式庫都認得、空白也算；一般瀏覽器不算', () => {
  for (const [ua, id] of [
    ['python-requests/2.32.3', 'python-requests'],
    ['Python/3.12 aiohttp/3.9.5', 'aiohttp'],
    ['Go-http-client/1.1', 'go-http-client'],
    ['curl/8.5.0', 'curl'],
    ['libwww-perl/6.72', 'libwww'],
    ['sqlmap/1.8#stable (https://sqlmap.org)', 'sqlmap'],
    ['Mozilla/5.00 (Nikto/2.5.0)', 'nikto'],
    ['Mozilla/5.0 (compatible; Nuclei - Open-source project (github.com/projectdiscovery/nuclei))', 'nuclei'],
    ['Mozilla/5.0 zgrab/0.x', 'zgrab'],
    ['masscan/1.3', 'masscan'],
    ['python-httpx/0.27.0', 'httpx'],
    ['DirBuster-1.0-RC1', 'dirbuster'],
    ['gobuster/3.6', 'gobuster'],
    ['Fuzz Faster U Fool v2.1.0 ffuf', 'ffuf'],
    ['', 'empty'],
    ['-', 'empty'],
  ])
    assert.equal(suspiciousUa(ua), id, ua);
  assert.equal(suspiciousUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), null);
});

test('時間：nginx（含時區）與 IIS（UTC）都換成毫秒', () => {
  assert.equal(timeOf('02/Oct/2026:09:00:01 +0800'), Date.UTC(2026, 9, 2, 1, 0, 1));
  assert.equal(timeOf('2026-10-02T01:00:01'), Date.UTC(2026, 9, 2, 1, 0, 1));
  assert.equal(timeOf('nonsense'), null);
  assert.equal(timeOf(null), null);
});

test('detectProbes：夾具——爆量、特徵路徑、掃描器 UA 列出；正常民眾與開放資料介接不列；--public 才算後台與閘道', () => {
  assert.ok(
    entries.every((e) => e.ip),
    'parseLog 帶出來源 IP',
  );
  const r = detectProbes(entries);
  const by = Object.fromEntries(r.clients.map((c) => [c.ip, c]));
  assert.deepEqual(Object.keys(by).sort(), ['198.51.100.23', '198.51.100.7', '203.0.113.66']);
  assert.equal(by['203.0.113.20'], undefined, '正常民眾：幾個 404（舊書籤、favicon）不該被列出');
  assert.equal(by['203.0.113.30'], undefined, 'python-requests 抓開放資料：UA 是弱訊號，單獨不列');

  const burst = by['198.51.100.7'];
  assert.equal(burst.burstMax, 40);
  assert.equal(burst.signatureHits.length, 0);
  assert.ok(burst.reasons.some((x) => /60 秒內 404 達 40 次/.test(x)));
  assert.ok(burst.reasons.some((x) => /路徑列舉/.test(x)));
  assert.equal(burst.action, 'block', '爆量＋列舉（≥ 5 分）建議封鎖');

  const sig = by['198.51.100.23'];
  assert.deepEqual(
    sig.signatureHits.map((h) => h.signature),
    ['env-file', 'git-dir', 'wp-login', 'path-traversal', 'backup-file', 'api-docs'],
  );
  assert.equal(sig.burstMax, 1, '慢慢掃：沒有爆量，靠特徵抓到');
  assert.equal(sig.firstAt, '2026-10-02T01:20:00.000Z');
  assert.equal(sig.lastAt, '2026-10-02T01:29:00.000Z');

  const scan = by['203.0.113.66'];
  assert.equal(scan.notFound, 0, '掃描器只打正常頁面也列出：UA 明說自己是掃描器');
  assert.ok(scan.reasons[0].includes('nuclei'));
  assert.ok(r.clients[0].score >= r.clients.at(-1).score, '依分數排序');
  assert.deepEqual({ seen: r.summary.clientsSeen, flagged: r.summary.flagged, pub: r.summary.public }, { seen: 6, flagged: 3, pub: false });

  const pub = detectProbes(entries, { public: true });
  const admin = pub.clients.find((c) => c.ip === '198.51.100.40');
  assert.ok(admin, '--public：打 /admin/、/api/gateway/ 的來源列出');
  assert.deepEqual(
    admin.signatureHits.map((h) => h.signature),
    ['admin', 'gateway'],
  );
});

test('detectProbes：特徵路徑回 2xx ⇒ 立即通報（escalate）；門檻可調；CDN 後面依信任代理取 X-Forwarded-For', () => {
  const t = (s) => `02/Oct/2026:10:00:${String(s).padStart(2, '0')} +0800`;
  const leaked = detectProbes([{ ip: '198.51.100.99', path: '/.git/config', status: 200, time: t(0), ua: 'Mozilla/5.0' }]);
  assert.equal(leaked.clients[0].action, 'escalate');
  assert.ok(leaked.clients[0].reasons.some((x) => /可能真的外洩/.test(x)));

  const many = Array.from({ length: 12 }, (_, i) => ({
    ip: '10.0.0.5',
    xff: `1.2.3.4, 198.51.100.${i < 10 ? 50 : 51}`,
    path: `/x${i}`,
    status: 404,
    time: t(i),
    ua: 'Mozilla/5.0',
  }));
  assert.equal(detectProbes(many, { burst: 10 }).clients[0]?.ip, '10.0.0.5', '沒設信任代理：所有人算成 CDN 一個來源（報表會誤判，所以要設）');
  const behind = detectProbes(many, { burst: 10, trustedProxies: ['10.0.0.0/8'] });
  assert.deepEqual(
    behind.clients.map((c) => c.ip),
    ['198.51.100.50'],
    '設了信任代理：取最後一個非代理位址；偽造在最左邊的 1.2.3.4 不採信',
  );
  assert.equal(detectProbes(many, { burst: 11, trustedProxies: ['10.0.0.0/8'] }).clients.length, 0, '門檻可調');
});

test('報表：Markdown 多一節「自動化探測跡象」（表格、理由、處置）；CLI --json 帶 probes、--public 生效', () => {
  const report = analyze(entries, {});
  report.probes = detectProbes(entries);
  const md = toMarkdown(report, { sources: ['access-probe.log'] });
  assert.match(md, /## 4\. 自動化探測跡象/);
  assert.match(md, /\| 分數 \| 來源 IP \|/);
  assert.match(md, /198\.51\.100\.7/);
  assert.match(md, /在 WAF 封鎖此來源/);
  assert.match(md, /通報資訊室/);
  assert.doesNotMatch(md.split('## 4.')[1], /203\.0\.113\.20/, '正常民眾不在探測表');

  const out = JSON.parse(
    execFileSync(process.execPath, ['scripts/analyze-404-log.mjs', FIXTURE, '--json', '--public', '--migration', 'none'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    }),
  );
  assert.equal(out.probes.summary.public, true);
  assert.ok(out.probes.clients.some((c) => c.ip === '198.51.100.40'));
  assert.equal(out.notFound, entries.filter((e) => e.status === 404).length, '原本的 404 分類照舊');
});
