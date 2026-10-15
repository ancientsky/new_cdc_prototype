// 第五十四輪：Yulun 2026-10-15 對第五十三輪三個待決事項都說「ok」（docs/deploy.md §26、guide-staff §57、architecture-decisions §42）。
//   一、人事室承辦人的職缺、秘書室承辦人的採購公告免審上線：lanes.json 快車道的 allowedAuthorsByType（只對該型別有效）。
//       機器檢查（schema、日期、個資）照擋，上線後公關室 24 小時內複核照舊；跨單位的人（總編輯等）改職缺仍要人審。
//   二、要求所有存檔帶版本碼：照 §25.6 的建議，稽核紀錄連續兩週沒有漏帶再打開；npm run gateway:basehash 判斷可不可以打開。
//   三、結核咳嗽兩週、M痘疫苗誰可以打兩則逾期 Q&A 也比照「假設已重新審閱」：審閱日改成決定日 2026-10-15，內容不動。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { applyGovernance } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { loadLanes, validateLanes, laneAuthorGate, laneForFiles } from '../scripts/lib/lanes.mjs';
import { adGroupsOf, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';
import { principalFrom, normAccount } from '../scripts/lib/gateway/auth.mjs';
import { createValidator } from '../scripts/lib/gateway/validate-item.mjs';
import { createLocalGit } from '../scripts/lib/gateway/git-local.mjs';
import { createGatewayApi, configFromEnv } from '../scripts/lib/gateway/index.mjs';
import { verifyAudit } from '../scripts/lib/gateway/store.mjs';
import { baseHashReadiness, readinessText, isMissing, isPageWrite, taipeiDay } from '../scripts/lib/gateway/basehash-report.mjs';
import { parseEml } from '../scripts/lib/mail-outbox.mjs';
import { contentVersion } from '../src/client/admin/content-version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = (p = 'r54-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const acct = (sub) => DEMO_ACCOUNTS.find((a) => a.sub === sub);
const P = (sub) =>
  principalFrom({ account: normAccount(sub), name: acct(sub).name, email: `${sub}@cdc-prototype.invalid`, groups: adGroupsOf(acct(sub)) }, 'dev');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fileItem = (rel) => JSON.parse(readRel(rel));
const gitShow = (repo, rel) => execFileSync('git', ['-C', repo, 'show', `main:${rel}`], { encoding: 'utf8' });
const LANES = loadLanes();
const JOB_REL = 'content/jobs/2026-09-30-epidemic-physician.json';
const JOB_RESULT_REL = 'content/jobs/2026-08-10-system-analyst.json'; // 有甄選結果
const TEN_REL = 'content/tenders/2026-09-22-campaign-video.json';
const NEWS_REL = 'content/news/2025-01-09-mmr-adults-measles.json';
const FAQS = ['faq.tb-cough-two-weeks', 'faq.mpox-who-vaccine'];

// ───────────────────────── 一、車道設定 ─────────────────────────
test('lanes.json：快車道的型別授權只給人事室（職缺）與秘書室（採購）的承辦人群組；整條車道的名單沒有變', () => {
  assert.deepEqual(validateLanes(LANES), []);
  const fast = LANES.lanes.fast;
  assert.deepEqual(fast.allowedAuthors, ['ancientsky'], '整條快車道（新聞稿、澄清稿…）的名單不動');
  assert.deepEqual(fast.allowedAuthorsByType, { job: ['team:CDC-WEB-personnel-editor'], tender: ['team:CDC-WEB-secretariat-editor'] });
  assert.equal(fast.postPublishReviewHours, 24, '上線後複核照舊');
  // 群組名稱就是示範帳號在 AD 會有的群組（auth-rules.js adGroupName）
  assert.ok(adGroupsOf(acct('demo-007')).includes('CDC-WEB-personnel-editor'));
  assert.ok(adGroupsOf(acct('demo-008')).includes('CDC-WEB-secretariat-editor'));
});

test('validateLanes：型別授權只能寫這條車道自己的型別、名單不能空、只用在自動合併車道', () => {
  const bad = (patch) => {
    const c = structuredClone(LANES);
    patch(c);
    return validateLanes(c).join('｜');
  };
  assert.match(
    bad((c) => (c.lanes.fast.allowedAuthorsByType.disease = ['team:x'])),
    /型別 disease 不在這條車道/,
  );
  assert.match(
    bad((c) => (c.lanes.fast.allowedAuthorsByType.job = [])),
    /job 必須是非空字串陣列/,
  );
  assert.match(
    bad((c) => (c.lanes.standard.allowedAuthorsByType = { faq: ['team:x'] })),
    /只用在自動合併車道/,
  );
  assert.match(
    bad((c) => (c.lanes.fast.allowedAuthorsByType = ['team:x'])),
    /必須是物件/,
  );
});

test('laneAuthorGate：每一個型別都要有自己的名單、作者都在裡面才算；名單只對該型別有效', () => {
  const fast = LANES.lanes.fast;
  const hr = ['CDC-WEB-personnel-editor'];
  const sec = ['CDC-WEB-secretariat-editor'];
  assert.equal(laneAuthorGate(fast, 'demo-007', ['job'], { teams: hr }).allowed, true);
  assert.match(laneAuthorGate(fast, 'demo-007', ['job'], { teams: hr }).reason, /型別授權/);
  assert.equal(laneAuthorGate(fast, 'demo-007', ['news'], { teams: hr }).allowed, false, '人事室不能讓新聞稿免審');
  assert.equal(laneAuthorGate(fast, 'demo-007', ['job', 'news'], { teams: hr }).allowed, false, '同一次也改了新聞稿就不行');
  assert.equal(laneAuthorGate(fast, 'demo-007', ['tender'], { teams: hr }).allowed, false, '人事室不能讓採購免審');
  assert.equal(laneAuthorGate(fast, 'demo-008', ['tender'], { teams: sec }).allowed, true);
  assert.equal(laneAuthorGate(fast, 'demo-008', ['job'], { teams: sec }).allowed, false);
  assert.equal(laneAuthorGate(fast, 'demo-008', ['job', 'tender'], { teams: [...hr, ...sec] }).allowed, true, '兩個群組都在：兩種型別都可以');
  assert.equal(laneAuthorGate(fast, 'ancientsky', ['news', 'job'], {}).allowed, true, '整條車道的名單照舊有效');
  assert.equal(laneAuthorGate(fast, null, ['job'], {}).allowed, false);
  assert.equal(laneAuthorGate(fast, 'demo-007', [], { teams: hr }).allowed, false);
});

test('laneForFiles（CI 同一套）：人事室群組改職缺 ⇒ 快車道自動合併；混了新聞稿 ⇒ 一般車道', () => {
  const hr = { author: 'hr-clerk', teams: ['CDC-WEB-personnel-editor'], since: '2026-10-15T01:00:00Z' };
  const a = laneForFiles([JOB_REL], hr);
  assert.equal(a.lane, 'fast');
  assert.equal(a.autoMerge, true);
  assert.equal(a.authorGate.allowed, true);
  const b = laneForFiles([JOB_REL, NEWS_REL], hr);
  assert.equal(b.lane, 'standard');
  assert.match(b.reasons.join('｜'), /型別授權只涵蓋 job、tender，這次還有 news/);
  assert.equal(laneForFiles([TEN_REL], hr).lane, 'standard', '人事室改採購 ⇒ 要人審');
  assert.equal(laneForFiles([TEN_REL], { ...hr, teams: ['CDC-WEB-secretariat-editor'] }).lane, 'fast');
});

// ───────────────────────── 一、寫入閘道 ─────────────────────────
function makeApi(extra = {}) {
  const d = tmpDir();
  const seedDir = path.join(d, 'seed');
  for (const sub of ['jobs', 'tenders']) {
    fs.mkdirSync(path.join(seedDir, sub), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'content', sub))) fs.copyFileSync(path.join(ROOT, 'content', sub, f), path.join(seedDir, sub, f));
  }
  const git = createLocalGit({ dir: path.join(d, 'repo'), seedDir });
  let t = Date.parse('2026-10-15T02:00:00Z');
  const api = createGatewayApi({
    stateFile: path.join(d, 'state.json'),
    auditFile: path.join(d, 'audit.jsonl'),
    outboxDir: path.join(d, 'outbox'),
    gitProvider: git,
    validator: createValidator(),
    csrfSecret: 't',
    now: () => t,
    ...extra,
  });
  const outbox = () =>
    fs.existsSync(path.join(d, 'outbox'))
      ? fs
          .readdirSync(path.join(d, 'outbox'))
          .filter((f) => f.endsWith('.eml'))
          .map((f) => parseEml(fs.readFileSync(path.join(d, 'outbox', f), 'utf8')))
      : [];
  return { api, W: api.workflow, repo: path.join(d, 'repo'), outbox, auditFile: path.join(d, 'audit.jsonl'), setNow: (iso) => (t = Date.parse(iso)) };
}

test('閘道：人事室承辦人送出職缺 ⇒ 不經審核直接上線（快車道）、通知公關室 24 小時內上線後複核', async () => {
  const { W, repo, outbox } = makeApi();
  const job = fileItem(JOB_REL);
  const changed = {
    ...job,
    deadlineAt: '2026-10-30',
    amendments: [...(job.amendments ?? []), { date: '2026-10-15', kind: 'extend', text: '報名截止延至 10 月 30 日。' }],
  };
  const s = await W.submit(P('demo-007'), { item: changed, baseHash: contentVersion(job) }, {});
  assert.equal(s.status, 'published');
  assert.equal(s.laneLabel, '快車道');
  assert.match(s.laneNotes.join('｜'), /檢查通過即上線/);
  const m = JSON.parse(gitShow(repo, JOB_REL));
  assert.equal(m.deadlineAt, '2026-10-30');
  const mails = outbox();
  assert.ok(
    mails.some((x) => /上線後複核/.test(JSON.stringify(x)) && /24 小時/.test(JSON.stringify(x))),
    JSON.stringify(mails).slice(0, 300),
  );
});

test('閘道：秘書室承辦人送出採購公告 ⇒ 直接上線；先存草稿再送也一樣', async () => {
  const { W, repo } = makeApi();
  const ten = fileItem(TEN_REL);
  const d = await W.saveDraft(P('demo-008'), { item: { ...ten, contact: '秘書室 王小姐 (02)2395-9825 #1234' }, baseHash: contentVersion(ten) });
  assert.equal(d.status, 'draft');
  const s = await W.submit(P('demo-008'), { submissionId: d.id }, {});
  assert.equal(s.status, 'published');
  assert.equal(JSON.parse(gitShow(repo, TEN_REL)).contact, '秘書室 王小姐 (02)2395-9825 #1234');
});

test('閘道：機器檢查照擋（甄選結果少了下架日 ⇒ 422，什麼都沒上線）；別單位照樣不能改', async () => {
  const { W, repo } = makeApi();
  const job = fileItem(JOB_RESULT_REL);
  const { unpublishAt, ...noUnpub } = job.result;
  void unpublishAt;
  await assert.rejects(W.submit(P('demo-007'), { item: { ...job, result: noUnpub }, baseHash: contentVersion(job) }, {}), (e) => e.status === 422);
  assert.equal(gitShow(repo, JOB_RESULT_REL), readRel(JOB_RESULT_REL));
  const ten = fileItem(TEN_REL);
  await assert.rejects(W.submit(P('demo-007'), { item: { ...ten, contact: 'x' }, baseHash: contentVersion(ten) }, {}), (e) => e.status === 403);
});

test('閘道：跨單位的人（公關室總編輯）改職缺 ⇒ 不在人事室群組，照舊走一般車道、要另一人核准', async () => {
  const { W } = makeApi();
  const job = fileItem(JOB_REL);
  const s = await W.submit(P('demo-004'), { item: { ...job, summary: `${job.summary}（公關室潤稿）` }, baseHash: contentVersion(job) }, {});
  assert.equal(s.status, 'in_review');
  assert.equal(s.laneLabel, '一般車道');
  assert.match(s.laneNotes.join('｜'), /只限授權名單/);
});

test('職缺、採購編輯頁的說明：有閘道時寫「人事室／秘書室承辦人送出即上線」，不再寫「核准後上線」', async () => {
  const { makeCtx } = await import('../scripts/lib/pages.mjs');
  const site = loadSite(config);
  site.today = '2026-10-15';
  applyGovernance(site);
  for (const [mod, re] of [
    ['../src/templates/admin/jobs-edit.mjs', /人事室承辦人.*送出.*上線/],
    ['../src/templates/admin/tenders-edit.mjs', /秘書室承辦人.*送出.*上線/],
  ]) {
    const tpl = await import(mod);
    const h = String(tpl.render(makeCtx(site, 'zh-TW', { path: '/admin/x/', alternates: ['zh-TW'], view: 'admin' })));
    const panel = h.match(/id="gw-panel"[\s\S]*?<\/p>/)?.[0] ?? h;
    assert.match(panel, re, mod);
    assert.match(panel, /公關室/, `${mod}：寫明上線後複核`);
  }
});

// ───────────────────────── 二、版本碼就緒檢查 ─────────────────────────
test('就緒檢查（純函式）：最近 14 天有人存檔且沒有漏帶 ⇒ 可以打開；有漏帶、太短、沒人用、紀錄被改過 ⇒ 不行，並說理由', async () => {
  const { createAuditLog } = await import('../scripts/lib/gateway/store.mjs');
  const write = (rows) => {
    const f = path.join(tmpDir('r54-audit-'), 'a.jsonl');
    let now = 0;
    const log = createAuditLog(f, { now: () => now });
    for (const r of rows) {
      now = Date.parse(r.at);
      const { at, action, result = 'ok', ...detail } = r;
      void at;
      log.write(action, { actor: { account: 'demo-007', name: '黃○婷', primaryUnit: 'unit.personnel', roles: ['編輯'], authMode: 'dev' }, result, detail });
    }
    return log.read();
  };
  // 10/1 有一次漏帶，之後每天都有帶碼的存檔
  const rows = [{ at: '2026-10-01T02:00:00Z', action: 'save-draft', contentId: 'job.a', fromPage: true, baseHash: 'missing' }];
  for (let d = 2; d <= 20; d++)
    rows.push({ at: `2026-10-${String(d).padStart(2, '0')}T03:00:00Z`, action: d % 2 ? 'submit' : 'save-draft', contentId: 'job.a', fromPage: true });
  rows.push({ at: '2026-10-05T04:00:00Z', action: 'submit', contentId: 'job.a' }); // 閘道自己組的再送出：不算寫入
  rows.push({ at: '2026-10-05T05:00:00Z', action: 'approve', contentId: 'job.a' });
  const entries = write(rows);
  assert.equal(verifyAudit(entries).ok, true);
  const early = baseHashReadiness(entries, { today: '2026-10-10' });
  assert.equal(early.ready, false);
  assert.match(early.reasons.join('｜'), /有 1 次存檔沒帶版本碼/);
  assert.equal(early.sources[0].contentId, 'job.a');
  assert.match(readinessText(early), /還不能打開/);
  const ok = baseHashReadiness(entries, { today: '2026-10-15' }); // 10/2～10/15 共 14 天
  assert.equal(ok.ready, true, ok.reasons.join('｜'));
  assert.equal(ok.window.missing, 0);
  assert.equal(ok.window.writes, 14);
  assert.equal(ok.totals.writes, 20, '閘道自己組的再送出、核准都不算從頁面存檔');
  assert.equal(ok.cleanSince, '2026-10-02');
  assert.match(readinessText(ok), /可以打開.*GATEWAY_REQUIRE_BASE_HASH=1|GATEWAY_REQUIRE_BASE_HASH=1/s);
  assert.equal(baseHashReadiness(entries, { today: '2026-10-15', minWrites: 20 }).ready, false, '要求更多存檔次數');
  assert.match(baseHashReadiness(entries.slice(5), { today: '2026-10-15' }).reasons.join('｜'), /雜湊鏈/);
  // 太短：紀錄從 10/2 才開始，到 10/10 不滿 14 天
  const short = write(rows.slice(1, 10));
  assert.match(baseHashReadiness(short, { today: '2026-10-10' }).reasons.join('｜'), /還不滿 14 天/);
  // 沒人用：兩週都沒有從頁面存檔
  const idle = write([
    { at: '2026-09-01T00:00:00Z', action: 'login' },
    { at: '2026-10-14T00:00:00Z', action: 'login' },
  ]);
  assert.match(baseHashReadiness(idle, { today: '2026-10-15' }).reasons.join('｜'), /只有 0 次從頁面存檔/);
  // 開關打開之後被擋的（428）也算「還有人沒帶」
  assert.equal(isMissing({ action: 'submit', result: 'denied', reason: 'version_required' }), true);
  assert.equal(isPageWrite({ action: 'submit', result: 'denied', reason: 'version_required' }), true);
  assert.equal(isMissing({ action: 'submit', result: 'denied', reason: 'forbidden' }), false);
  assert.equal(taipeiDay('2026-10-14T16:30:00Z'), '2026-10-15', '台灣日期');
});

test('閘道的稽核紀錄：從頁面送來的存檔記 fromPage，沒帶碼另記 missing；閘道自己組的「不用修改，再送出」不記 fromPage；npm run gateway:basehash 讀得懂', async () => {
  const { W, auditFile, setNow } = makeApi({
    lanesCfg: { ...LANES, lanes: { ...LANES.lanes, fast: { ...LANES.lanes.fast, allowedAuthorsByType: undefined } } },
  });
  const job = fileItem(JOB_REL);
  setNow('2026-10-01T02:00:00Z');
  const s = await W.saveDraft(P('demo-007'), { item: { ...job, summary: `${job.summary}（舊頁面）` } });
  setNow('2026-10-02T02:00:00Z');
  await W.saveDraft(P('demo-007'), { item: { ...job, summary: `${job.summary}（新頁面）` }, submissionId: s.id, baseHash: s.contentHash });
  setNow('2026-10-03T02:00:00Z');
  await W.submit(P('demo-007'), { submissionId: s.id }, {});
  const rows = fs
    .readFileSync(auditFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const writes = rows.filter((r) => ['save-draft', 'submit'].includes(r.action) && r.result === 'ok');
  assert.deepEqual(
    writes.map((r) => [r.action, r.fromPage ?? null, r.baseHash ?? null]),
    [
      ['save-draft', true, 'missing'],
      ['save-draft', true, null],
      ['submit', null, null],
    ],
  );
  const run = (today) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts/gateway-basehash.mjs'), `--file=${auditFile}`, `--today=${today}`], { encoding: 'utf8' });
  const r1 = run('2026-10-03');
  assert.equal(r1.status, 1);
  assert.match(r1.stdout, /還不能打開/);
  assert.match(r1.stdout, /黃○婷/);
  const r2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gateway-basehash.mjs'), `--file=${auditFile}`, '--today=2026-10-15', '--json'], {
    encoding: 'utf8',
  });
  // 紀錄從 10/1 起；10/2～10/15 這 14 天沒有漏帶、有 1 次從頁面存檔（預設至少 1 次）⇒ 可以打開
  assert.equal(r2.status, 0, r2.stdout);
  assert.equal(JSON.parse(r2.stdout).ready, true);
  const r3 = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gateway-basehash.mjs'), '--file=/nonexistent/a.jsonl'], { encoding: 'utf8' });
  assert.equal(r3.status, 2);
  assert.equal(configFromEnv({ GATEWAY_LANES_FILE: 'x.json' }).lanesFile, path.join(ROOT, 'x.json'));
  assert.equal(configFromEnv({}).lanesFile, '');
});

test('GATEWAY_LANES_FILE 指到形狀不對的車道設定 ⇒ 閘道不啟動（不拿壞掉的名單決定誰能免審）', () => {
  const d = tmpDir('r54-lanes-');
  const f = path.join(d, 'lanes.json');
  const bad = structuredClone(LANES);
  bad.lanes.fast.allowedAuthors = [];
  fs.writeFileSync(f, JSON.stringify(bad));
  assert.throws(
    () =>
      createGatewayApi({
        lanesFile: f,
        stateFile: path.join(d, 's.json'),
        auditFile: path.join(d, 'a.jsonl'),
        outboxDir: path.join(d, 'o'),
        gitProvider: { ensureReady: async () => {} },
        csrfSecret: 't',
      }),
    /GATEWAY_LANES_FILE.*allowedAuthors/,
  );
});

// ───────────────────────── 三、兩則逾期 Q&A 假設已重審 ─────────────────────────
function governed(today) {
  const s = loadSite(config);
  s.today = today;
  applyGovernance(s);
  s.searchIndex = buildSearchIndex(s);
  return s;
}

test('兩則 Q&A：審閱日 2026-10-15（決定日），下次 2027-04-15；BUILD_TODAY=2026-10-01 與 2026-10-15 都不逾期、在 AI 白名單、機器翻譯不進答案索引', () => {
  for (const today of ['2026-10-01', '2026-10-15']) {
    const s = governed(today);
    for (const id of FAQS) {
      const item = s.byId.get(id);
      assert.equal(item.reviewedAt, '2026-10-15', id);
      assert.equal(item.gov.overdue, false, `${id} @ ${today}`);
      assert.equal(item.gov.nextReviewAt, '2027-04-15', id);
      assert.equal(item.gov.whitelist.effective, true, `${id} @ ${today}：${item.gov.whitelist.reasons.join('、')}`);
      const chunks = s.searchIndex.public.filter((c) => c.contentId === id);
      assert.ok(chunks.length >= 1, `${id} 進了答案索引`);
      // 機器翻譯不進答案索引；人工審過的譯文（英文）可以
      const human = [
        'zh-TW',
        ...Object.entries(item.languages)
          .filter(([, l]) => l.status === 'reviewed')
          .map(([k]) => k),
      ];
      for (const lang of new Set(chunks.map((c) => c.lang ?? 'zh-TW'))) assert.ok(human.includes(lang), `${id}：${lang} 不是人工審過的語言`);
    }
  }
});

test('兩則 Q&A：只改了最上層的審閱日；譯文的審閱日與狀態沒動（假設重審不等於譯文也重審）', () => {
  const want = { 'content/faq/tb-cough-two-weeks.json': '2026-04-01', 'content/faq/mpox-who-vaccine.json': '2026-04-02' };
  for (const [rel, old] of Object.entries(want)) {
    const j = fileItem(rel);
    assert.equal(j.reviewedAt, '2026-10-15', rel);
    const reviewed = Object.entries(j.languages).filter(([, l]) => l.status === 'reviewed');
    assert.ok(reviewed.length >= 1, rel);
    for (const [lang, l] of reviewed) assert.equal(l.reviewedAt, old, `${rel} ${lang}`);
    assert.ok(
      Object.values(j.languages).some((l) => l.status === 'machine'),
      `${rel}：機器翻譯草稿仍是草稿`,
    );
  }
});
