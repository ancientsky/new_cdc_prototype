// 第三十輪（#55）：個資不進 Git。
// (1) 甄選結果只有報名編號、必填下架日、到期由建置拿掉名單（頁面、API、RSS、索引、.md）、下架前待辦、externalUrl；
// (2) 全庫個資掃描（身分證／居留證檢查碼、手機、個人信箱、名單語境姓名；白名單；遮罩輸出；CLI）；
// (3) 表單端點設定（site.config.mjs forms → 頁面直接 POST、CSP 自動加來源、每個表單頁有個資蒐集告知）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { govern, memWriter, config } from './helpers.mjs';
import { ROOT } from '../scripts/lib/load.mjs';
import {
  defaultUnpublishAt, jobResultProblems, resultTakenDown, RESULT_UNPUBLISH_NOTICE_DAYS,
} from '../src/client/careers-rules.js';
import { withdrawJobResult } from '../scripts/lib/governance.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { emitApi } from '../scripts/lib/emit-api.mjs';
import { buildFeeds } from '../scripts/lib/emit-seo.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as careers from '../src/templates/public/careers.mjs';
import * as contact from '../src/templates/public/contact.mjs';
import * as subscribe from '../src/templates/public/subscribe.mjs';
import {
  detect, validTwId, validOldArc, maskValue, scanPaths, loadAllowlist, inScope, piiErrors, formatHit, ALLOWLIST_PATH,
} from '../scripts/lib/pii-scan.mjs';
import { formSetting, formErrors, formOrigins, envKey } from '../scripts/lib/forms.mjs';
import { securityHeaders } from '../scripts/lib/emit-headers.mjs';
import { sendToEndpoint } from '../src/client/form-post.js';
import { STRINGS } from '../src/client/i18n.js';

const str = (r) => String(r);
const KAOPING = 'job.2026-05-25-quarantine-officer-kaoping';
const EASTERN = 'job.2026-06-22-admin-assistant-eastern';
const srcOf = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'content/jobs', `${id.replace(/^job\./, '')}.json`), 'utf8'));
const numbersOf = (j) => [...(j.result?.admitted ?? []), ...(j.result?.waitlist ?? []), ...(j.waitlistUpdates ?? [])].map((r) => r.candidateNo);

/* ───────── (1) 下架日規則 ───────── */
test('下架日建議值：公告日 + 3 個月；備取有效期更晚就取其隔天；沒有公告日回 null', () => {
  assert.equal(defaultUnpublishAt({ publishedAt: '2026-10-20' }), '2027-01-20');
  assert.equal(defaultUnpublishAt({ publishedAt: '2026-10-20', waitlist: [{ rank: 1, candidateNo: 'x', validUntil: '2027-04-20' }] }), '2027-04-21');
  assert.equal(defaultUnpublishAt({ publishedAt: '2026-10-20', waitlist: [{ rank: 1, candidateNo: 'x', validUntil: '2026-11-01' }] }), '2027-01-20');
  assert.equal(defaultUnpublishAt({}), null);
  assert.equal(RESULT_UNPUBLISH_NOTICE_DAYS, 14);
});

test('下架日檢核：必填、至少 30 日、至多 12 個月、晚於備取有效期；externalUrl 與名單擇一；兩者皆無只有「已過下架日」才合法', () => {
  const j = (result, extra = {}) => ({ result, ...extra });
  const A = [{ seq: 1, candidateNo: '1151001-001' }];
  assert.ok(jobResultProblems(j({ publishedAt: '2026-10-20', admitted: A }))[0].includes('建議 2027-01-20'));
  assert.ok(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2026-11-01', admitted: A }))[0].includes('至少要公開 30 日'));
  assert.ok(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2027-12-01', admitted: A }))[0].includes('最多公開 12 個月'));
  assert.ok(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', admitted: A, waitlist: [{ rank: 1, candidateNo: 'w', validUntil: '2027-02-01' }] }))[0].includes('不得早於或等於備取有效期限'));
  assert.deepEqual(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', admitted: A })), []);
  assert.ok(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', externalUrl: 'https://hr.example.gov.tw/r/1', admitted: A })).some((e) => e.includes('擇一')));
  assert.ok(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', externalUrl: 'http://hr.example.gov.tw/r/1' })).some((e) => e.includes('https://')));
  assert.deepEqual(jobResultProblems(j({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', externalUrl: 'https://hr.example.gov.tw/r/1' })), []);
  const bare = j({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20' });
  assert.ok(jobResultProblems(bare, '2026-12-01').some((e) => e.includes('externalUrl')), '還沒到下架日就把名單拿掉 ⇒ 錯誤');
  assert.deepEqual(jobResultProblems(bare, '2027-01-20'), [], '下架日當天起名單可以（也應該）從 JSON 刪掉');
  assert.equal(resultTakenDown(bare, '2027-01-19'), false); assert.equal(resultTakenDown(bare, '2027-01-20'), true);
});

test('schema：名單列不得有 nameMasked 或任何姓名欄；result 必填 unpublishAt', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
  for (const f of fs.readdirSync(path.join(ROOT, 'schemas'))) if (f.endsWith('.json') && f !== 'job.json') { try { ajv.addSchema(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', f), 'utf8'))); } catch { /* 重複 id 等忽略 */ } }
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/job.json'), 'utf8'));
  const resultSchema = { $schema: schema.$schema, $defs: schema.$defs, ...schema.properties.result };
  const v = ajv.compile(resultSchema);
  assert.ok(v({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', admitted: [{ seq: 1, candidateNo: '1151001-001' }] }), JSON.stringify(v.errors));
  assert.ok(!v({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', admitted: [{ seq: 1, candidateNo: '1151001-001', nameMasked: '王○明' }] }));
  assert.ok(!v({ publishedAt: '2026-10-20', unpublishAt: '2027-01-20', waitlist: [{ rank: 1, candidateNo: 'x', validUntil: '2027-01-01', 姓名: '王小明' }] }));
  assert.ok(!v({ publishedAt: '2026-10-20', admitted: [] }), 'unpublishAt 必填');
});

/* ───────── (1) 到期下架：治理引擎拿掉名單，所有輸出都沒有 ───────── */
test('下架前 14 日起出低優先待辦；到期後名單從頁面、API、RSS、索引、.md 全部消失，原始檔還留著名單 ⇒ 中優先待辦請人事室刪除', () => {
  const src = srcOf(KAOPING);
  const nums = numbersOf(src);
  assert.ok(nums.length > 0 && src.result.unpublishAt === '2026-10-11');
  // 下架前 10 天
  const before = govern('2026-10-01');
  const pre = before.gov.todos.filter((t) => t.kind === 'job-result-unpublish' && t.itemId === KAOPING);
  assert.equal(pre.length, 1); assert.equal(pre[0].severity, 'low'); assert.equal(pre[0].phase, 'upcoming');
  assert.ok(numbersOf(before.byId.get(KAOPING)).length > 0, '下架前名單還在');
  // 下架後
  const after = govern('2026-10-15');
  const j = after.byId.get(KAOPING);
  assert.deepEqual(numbersOf(j), []); assert.equal(j.gov.resultTakenDown, true); assert.equal(j.gov.resultListInSource, true);
  assert.deepEqual(Object.keys(j.result).sort(), ['publishedAt', 'refNo', 'unpublishAt'].filter((k) => k in j.result).sort());
  const post = after.gov.todos.filter((t) => t.kind === 'job-result-unpublish' && t.itemId === KAOPING);
  assert.equal(post.length, 1); assert.equal(post[0].severity, 'medium'); assert.equal(post[0].phase, 'remove-from-source');
  // 再跑一次治理不會弄丟「原始檔還有名單」的旗標（冪等）
  assert.equal(withdrawJobResult(j, '2026-10-15').listInSource, true);
  // 頁面
  const ctx = makeCtx(after, 'zh-TW', { path: '/careers/' });
  const page = str(careers.render(ctx, { item: j }));
  assert.match(page, /data-result="down"/); assert.match(page, /甄選結果已於 .*2026.*下架/); assert.match(page, /人事室/);
  for (const n of nums) assert.ok(!page.includes(n), `頁面不得再有 ${n}`);
  const md = String(careers.markdown(ctx, { item: j }));
  for (const n of nums) assert.ok(!md.includes(n), `.md 不得再有 ${n}`);
  // API、RSS、答案索引
  const { write, files } = memWriter();
  emitApi(after, write);
  const blob = [...files.values()].join('\n');
  for (const n of nums) assert.ok(!blob.includes(n), `API 不得再有 ${n}`);
  const feeds = JSON.stringify(buildFeeds(after));
  for (const n of nums) assert.ok(!feeds.includes(n), `RSS 不得再有 ${n}`);
  const idx = JSON.stringify(buildSearchIndex(after));
  for (const n of nums) assert.ok(!idx.includes(n), `索引不得再有 ${n}`);
});

test('externalUrl（建議做法）：JSON 沒有名單；頁面連到人事系統並寫明下架日；API 不含名單', () => {
  const s = govern('2026-10-10');
  const j = s.byId.get(EASTERN);
  assert.ok(j.result.externalUrl && !j.result.admitted && !j.result.waitlist);
  assert.equal(j.gov.resultExternal, true);
  const h = str(careers.render(makeCtx(s, 'zh-TW', { path: '/careers/' }), { item: j }));
  assert.match(h, /data-result="external"/); assert.ok(h.includes('/pending/'), '連到人事系統（原型為 /pending/ 佔位）');
  assert.ok(!/<table[^>]*c-jobresult|<th[^>]*>報名編號/.test(h.match(/<section class="c-block c-jobresult"[\s\S]*?<\/section>/)[0]), '本站不列名單');
});

/* ───────── (2) 個資掃描 ───────── */
test('身分證與居留證：只認通過檢查碼的號碼（隨手打的 10 碼、研究核准文號不誤報）', () => {
  assert.ok(validTwId('A123456789')); assert.ok(!validTwId('A123456788'));
  assert.ok(validTwId('A800000014'), '新式居留證（第二碼 8）同一套檢查碼');
  assert.ok(validOldArc('AC01234503')); assert.ok(!validOldArc('AC01234504'));
  assert.equal(maskValue('A123456789'), 'A1******89'); assert.equal(maskValue('0912-345-678'), '09**-***-*78');
  const kinds = (s) => detect(s).map((h) => h.kind);
  assert.deepEqual(kinds('身分證 A123456789'), ['national-id']);
  assert.deepEqual(kinds('居留證 A800000014、AC01234503'), ['arc', 'arc']);
  assert.deepEqual(kinds('核准文號 N202502011、FD51699031、A123456788'), []);
});

test('手機：各種寫法都抓；小數、更長的數字、市話與 0800 不抓', () => {
  const vals = (s) => detect(s).filter((h) => h.kind === 'mobile').map((h) => h.value);
  assert.deepEqual(vals('0912-345-678／0912 345 678／0912345678／+886-912-345-678／(+886)912345678／+886 912 345 678'), ['0912-345-678', '0912 345 678', '0912345678', '+886-912-345-678', '(+886)912345678', '+886 912 345 678']);
  assert.deepEqual(vals('0.0912345678、10912345678、0912-345-6789、02-2395-9825、0800-001922、+886-800-001922'), []);
});

test('Email：機關網域與保留網域放行，其他（個人信箱）抓；圖片檔名不誤報', () => {
  const allow = loadAllowlist(ROOT);
  const hits = (s) => detect(s).filter((h) => h.kind === 'email').map((h) => h.value);
  assert.deepEqual(hits('wang.xm@gmail.com、logo@2x.png'), ['wang.xm@gmail.com']);
  for (const d of ['gov.tw', 'ancientsky.github.io', 'invalid']) assert.ok(allow.domains.includes(d), d);
});

test('姓名（啟發式）：只在錄取／正取／備取／申請人／姓名語境、常見姓氏開頭；整串名單都抓（含遮罩姓名）；一般詞不誤報', () => {
  const names = (s) => detect(s).filter((h) => h.kind === 'person-name').map((h) => h.value);
  assert.deepEqual(names('正取：王小明、林大華、陳○宏'), ['王小明', '林大華', '陳○宏']);
  assert.deepEqual(names('錄取人員為歐陽娜娜。'), ['歐陽娜娜']);
  assert.deepEqual(names('申請人 張三'), ['張三']);
  for (const s of ['錄取方式：書面審查', '備取：高雄市民', '錄取名單：請見附件', '姓名欄位', '申請人所屬機關', '報名人數', '正取 2 名', '考生 請攜帶身分證']) assert.deepEqual(names(s), [], s);
});

test('掃描輸出：檔案＋JSON 路徑＋遮罩片段，絕不印出完整號碼或姓名；白名單（附理由）可放行，沒寫理由算錯', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-'));
  fs.mkdirSync(path.join(dir, 'content/jobs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'content/governance'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content/jobs/x.json'), JSON.stringify({ result: { note: '請 A123456789 與 0912-345-678 聯絡 wang.xm@gmail.com', admitted: [{ seq: 1, candidateNo: '1150924-012', note: '正取：王小明、林大華' }] }, contact: '1922' }));
  fs.writeFileSync(path.join(dir, 'content/a.md'), '第一行\n聯絡人手機 0987654321\n');
  let r = scanPaths(dir);
  const out = r.hits.map(formatHit).join('\n');
  assert.equal(r.hits.length, 6, out);
  assert.ok(r.hits.some((h) => h.file === 'content/jobs/x.json' && h.where === '$.result.note' && h.kind === 'national-id' && h.masked === 'A1******89'));
  assert.ok(r.hits.some((h) => h.where === '$.result.admitted[0].note' && h.kind === 'person-name' && h.masked === '王＊＊'));
  assert.ok(r.hits.some((h) => h.file === 'content/a.md' && h.where === '第 2 行' && h.kind === 'mobile'));
  for (const secret of ['A123456789', '0912-345-678', '0987654321', 'wang.xm@', '王小明', '林大華']) assert.ok(!out.includes(secret), `輸出不得含 ${secret}`);
  // 白名單：限定檔案、附理由
  fs.writeFileSync(path.join(dir, ALLOWLIST_PATH), JSON.stringify({ entries: [{ kind: 'national-id', value: 'A123456789', files: ['content/jobs/x.json'], reason: '測試樣本（公開示範號碼）' }], numbers: [{ value: '0987-654-321', reason: '假設這是機關公務手機' }] }));
  r = scanPaths(dir);
  assert.equal(r.hits.length, 4); assert.ok(!r.hits.some((h) => h.kind === 'national-id'));
  fs.writeFileSync(path.join(dir, ALLOWLIST_PATH), JSON.stringify({ entries: [{ kind: 'national-id', value: 'A123456789' }] }));
  assert.ok(scanPaths(dir).allowlistErrors.some((e) => e.includes('reason')), '沒寫理由的白名單算錯');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('範圍：content/ 與 data/snapshots/；白名單檔本身、程式與測試不掃；實際內容零命中（評測題的示範號碼靠白名單）', () => {
  assert.ok(inScope('content/jobs/a.json')); assert.ok(inScope('data/snapshots/x.json')); assert.ok(inScope('content/assets/x/y.pdf'));
  assert.ok(!inScope(ALLOWLIST_PATH)); assert.ok(!inScope('tests/jobs.test.mjs')); assert.ok(!inScope('docs/guide-staff.md'));
  assert.deepEqual(piiErrors(ROOT), []);
  const allow = loadAllowlist(ROOT);
  assert.deepEqual(allow.errors, []);
  for (const e of JSON.parse(fs.readFileSync(path.join(ROOT, ALLOWLIST_PATH), 'utf8')).numbers) assert.ok(e.reason.length >= 4);
  // 拿掉白名單就會抓到評測題 AD007 的示範號碼（證明白名單在作用）
  const r = scanPaths(ROOT, ['content/governance/eval-set.json'], { allowlist: { numbers: new Set(), domains: [], entries: [], errors: [] } });
  assert.ok(r.hits.some((h) => h.kind === 'national-id') && r.hits.some((h) => h.kind === 'mobile'));
});

test('CLI：node scripts/pii-scan.mjs 有命中 exit 1、在 GitHub Actions 輸出 ::error 註記（遮罩）；範圍外檔案略過 exit 0', () => {
  const cli = path.join(ROOT, 'scripts/pii-scan.mjs');
  assert.match(execFileSync(process.execPath, [cli, 'content/jobs', 'README.md'], { cwd: ROOT, encoding: 'utf8' }), /個資掃描通過/);
  let err;
  try { execFileSync(process.execPath, [cli, '--all', 'docs/careers-privacy.md'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' }, stdio: 'pipe' }); } catch (e) { err = e; }
  assert.equal(err?.status, 1);
  assert.match(err.stdout, /::error file=docs\/careers-privacy\.md,title=個資掃描：身分證字號::/);
  assert.ok(!`${err.stdout}${err.stderr}`.includes('A123456789'));
});

test('CI：content-pr.yml 在合併前跑個資掃描（PR 改到的檔），lane-bot 表格有「個資掃描」列、未通過擋合併', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github/workflows/content-pr.yml'), 'utf8');
  assert.match(y, /id: pii\n\s+continue-on-error: true\n\s+run: git diff --name-only -z --diff-filter=d origin\/main\.\.\.HEAD \| xargs -0 node scripts\/pii-scan\.mjs/);
  assert.ok(y.indexOf('id: pii') < y.indexOf('id: lint'), '在 Lint 之前');
  assert.match(y, /\| 個資掃描（[^|]*） \| " \+ icon\(e\.PII\)/);
  assert.match(y, /\[ "\$PII" != "success" \]; then ACTION=blocked/);
  assert.match(y, /steps\.pii\.outcome != 'success'\n/);
  for (const m of y.matchAll(/uses: ([^\s@]+)@(\S+)/g)) assert.match(m[2], /^[0-9a-f]{40}$/, `${m[1]} 仍固定 commit SHA`);
});

/* ───────── (3) 表單端點 ───────── */
const withForms = (forms) => ({ ...config, forms: { ...config.forms, ...forms } });

test('表單設定：預設全為 mock；post 要 https 端點；署長信箱 link 要陳情系統網址；矛盾設定在建置時報錯', () => {
  for (const k of ['careersApply', 'directorMailbox', 'newsletter']) assert.equal(formSetting(config, k).active, 'mock', k);
  assert.deepEqual(formErrors(config), []);
  assert.deepEqual(formOrigins(config), []);
  const c = withForms({ careersApply: { endpoint: 'https://forms.cdc.gov.tw/careers/apply', mode: 'post', receiver: 'unit.personnel' }, directorMailbox: { endpoint: '', mode: 'link', petitionUrl: 'https://www.cdc.gov.tw/petition', receiver: 'unit.secretariat' } });
  assert.equal(formSetting(c, 'careersApply').active, 'post'); assert.equal(formSetting(c, 'careersApply').origin, 'https://forms.cdc.gov.tw');
  assert.equal(formSetting(c, 'directorMailbox').active, 'link');
  assert.deepEqual(formErrors(c), []);
  assert.ok(formErrors(withForms({ newsletter: { endpoint: 'http://evil.example.com/x', mode: 'post' } })).some((e) => e.includes('https://')));
  assert.ok(formErrors(withForms({ newsletter: { endpoint: '', mode: 'post' } })).some((e) => e.includes('沒有 endpoint')));
  assert.ok(formErrors(withForms({ careersApply: { endpoint: '', mode: 'link' } })).some((e) => e.includes('只能是')));
  assert.ok(formErrors(withForms({ newsletter: { endpoint: 'https://x.gov.tw/n', mode: 'mock' } })).some((e) => e.includes('不會送出')));
  assert.equal(formSetting(withForms({ newsletter: { endpoint: 'http://localhost:8787/n', mode: 'post' } }), 'newsletter').active, 'post', '本機測試可用 http://localhost');
  assert.equal(envKey('directorMailbox'), 'DIRECTOR_MAILBOX');
});

test('CSP：只有生效中的 post 端點來源加進 connect-src 與 form-action，其他指令不變；沒設端點時與原本相同', () => {
  const base = securityHeaders({ hashes: [] })['Content-Security-Policy'];
  assert.match(base, /connect-src 'self' https:\/\/api\.anthropic\.com;/); assert.match(base, /form-action 'self';/);
  const c = withForms({ careersApply: { endpoint: 'https://forms.cdc.gov.tw/careers/apply', mode: 'post' }, newsletter: { endpoint: 'https://mail.cdc.gov.tw/newsletter', mode: 'post' }, directorMailbox: { endpoint: '', mode: 'link', petitionUrl: 'https://petition.example.gov.tw/' } });
  const csp = securityHeaders({ hashes: [], formOrigins: formOrigins(c) })['Content-Security-Policy'];
  assert.match(csp, /connect-src 'self' https:\/\/api\.anthropic\.com https:\/\/forms\.cdc\.gov\.tw https:\/\/mail\.cdc\.gov\.tw;/);
  assert.match(csp, /form-action 'self' https:\/\/forms\.cdc\.gov\.tw https:\/\/mail\.cdc\.gov\.tw;/);
  assert.ok(!csp.includes('petition.example.gov.tw'), '連結模式不開 CSP（只是超連結）');
  assert.equal(csp.replace(/ https:\/\/(forms|mail)\.cdc\.gov\.tw/g, ''), base, '其他指令完全不變');
});

test('頁面：報名、署長信箱、電子報都有收件單位與個資蒐集告知；設了端點就直接 POST（不再顯示模擬）、署長信箱 link 模式連到陳情系統', () => {
  const s = govern('2026-10-01');
  const open = s.collections.jobs.find((j) => j.status === 'published' && j.gov?.jobStage === 'open' && j.gov?.applyOnSite);
  assert.ok(open, '有開放中、本站報名的職缺');
  const ctxFor = (site) => makeCtx(site, 'zh-TW', { path: '/' });
  // 預設（mock）
  {
    const a = str(careers.render(ctxFor(s), { item: open, apply: true, open: true }));
    assert.match(a, /data-form-notice="careersApply" data-form-mode="mock"/); assert.match(a, /data-demo-banner/); assert.ok(!/data-endpoint=/.test(a));
    assert.match(a, /收件單位：/); assert.match(a, /人事室/);
  }
  const c0 = str(contact.render(ctxFor(s)));
  assert.match(c0, /data-form-notice="directorMailbox" data-form-mode="mock"/); assert.match(c0, /data-mailbox /);
  const n0 = str(subscribe.render(ctxFor(s)));
  assert.match(n0, /data-form-notice="newsletter" data-form-mode="mock"/); assert.match(n0, /data-backend="auto"/);
  // 設端點
  const live = { ...s, config: withForms({
    careersApply: { endpoint: 'https://forms.cdc.gov.tw/careers/apply', mode: 'post', receiver: 'unit.personnel' },
    directorMailbox: { endpoint: 'https://forms.cdc.gov.tw/mailbox', mode: 'post', receiver: 'unit.secretariat' },
    newsletter: { endpoint: 'https://mail.cdc.gov.tw/newsletter', mode: 'post', receiver: 'unit.pr' },
  }) };
  {
    const a = str(careers.render(ctxFor(live), { item: open, apply: true, open: true }));
    assert.match(a, /data-endpoint="https:\/\/forms\.cdc\.gov\.tw\/careers\/apply" action="https:\/\/forms\.cdc\.gov\.tw\/careers\/apply" method="post" enctype="multipart\/form-data"/);
    assert.ok(!/data-demo-banner/.test(a)); assert.match(a, /data-live-banner/); assert.match(a, /forms\.cdc\.gov\.tw（疾管署的個資表單系統）/);
  }
  const c1 = str(contact.render(ctxFor(live)));
  assert.match(c1, /<form class="c-mailform" data-form-post data-form="director-mailbox" data-endpoint="https:\/\/forms\.cdc\.gov\.tw\/mailbox" action="https:\/\/forms\.cdc\.gov\.tw\/mailbox" method="post">/);
  assert.ok(!/data-mailbox /.test(c1) && !/mailbox@example/.test(c1), '不再有 mailto 示範');
  assert.deepEqual(contact.meta(ctxFor(live)).scripts, ['/assets/js/form-post.js']);
  const n1 = str(subscribe.render(ctxFor(live)));
  assert.match(n1, /data-backend="live" data-endpoint="https:\/\/mail\.cdc\.gov\.tw\/newsletter"/);
  const link = { ...s, config: withForms({ directorMailbox: { endpoint: '', mode: 'link', petitionUrl: 'https://petition.example.gov.tw/cdc', receiver: 'unit.secretariat' } }) };
  const c2 = str(contact.render(ctxFor(link)));
  assert.match(c2, /href="https:\/\/petition\.example\.gov\.tw\/cdc"[^>]*data-petition-link/); assert.ok(!/<form class="c-mailform"/.test(c2), 'link 模式本站不收資料');
  for (const k of ['form.notice.t', 'form.notice.where.post', 'form.notice.purpose.careersApply', 'form.petition.go', 'form.sent.no']) assert.ok(STRINGS['zh-TW'][k] && STRINGS.en[k], k);
});

test('送出契約（form-post.js）：JSON 本文含 form／submissionId／fields、不帶 cookie；回 receiptNo；4xx 不備援；網路錯誤回 network（頁面改走一般表單 POST）', async () => {
  const calls = [];
  const ok = await sendToEndpoint('https://forms.cdc.gov.tw/mailbox', { subject: '測試', body: '內容' }, { form: 'director-mailbox' }, { fetchFn: async (u, o) => { calls.push([u, o]); return { ok: true, status: 200, json: async () => ({ ok: true, receiptNo: 'M-001' }) }; } });
  assert.equal(ok.ok, true); assert.equal(ok.receiptNo, 'M-001');
  const [u, o] = calls[0];
  assert.equal(u, 'https://forms.cdc.gov.tw/mailbox'); assert.equal(o.method, 'POST'); assert.equal(o.credentials, 'omit'); assert.equal(o.headers['Content-Type'], 'application/json');
  const b = JSON.parse(o.body);
  assert.equal(b.form, 'director-mailbox'); assert.match(b.submissionId, /\w{8,}/); assert.deepEqual(b.fields, { subject: '測試', body: '內容' });
  const bad = await sendToEndpoint('https://x.gov.tw/', {}, { form: 'f' }, { fetchFn: async () => ({ ok: false, status: 422, json: async () => ({ ok: false, message: '內容太短' }) }) });
  assert.deepEqual([bad.ok, bad.error, bad.status, bad.message], [false, 'http', 422, '內容太短']);
  const net = await sendToEndpoint('https://x.gov.tw/', {}, { form: 'f' }, { fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual([net.ok, net.error], [false, 'network']); assert.ok(net.submissionId, '備援送出沿用同一個 submissionId（端點據以去重）');
});
