// 第四十輪：content-pr 拆成 test／lane 兩個 job（#81）、格式與型別檢查進 CI（#82）、a11y 殘留項（#83）。
// 本機沒辦法跑 GitHub Actions，所以這裡做三件事：
//   1. 結構檢查——寫入權限只在 lane job；lane job 沒有 checkout／npm／node；沒有 pull_request_target。
//   2. 每個 run 區塊用 `bash -n` 檢查語法（${{ }} 先換成佔位字）。
//   3. 把 lane job 的「驗證 artifact」步驟和「產生留言」的 jq 程式真的跑一遍（假的 gh、假的 GITHUB_ENV），
//      包含偽造的 artifact（少報檔案、列舉值夾帶換行、不明車道）要被擋下來。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WF_DIR = '.github/workflows';
const workflows = fs.readdirSync(path.join(ROOT, WF_DIR)).filter((f) => f.endsWith('.yml'));

/** 把 `jobs:` 之後依兩格縮排的鍵切成 { 名稱: 區塊文字 }（repo 沒有 YAML 解析套件，也不為此新增相依） */
function jobsOf(text) {
  const after = text.split(/^jobs:\n/m)[1] ?? '';
  const out = {};
  let cur = null;
  for (const line of after.split('\n')) {
    const m = line.match(/^ {2}([\w-]+):\s*$/);
    if (m) {
      cur = m[1];
      out[cur] = '';
    } else if (cur) out[cur] += `${line}\n`;
  }
  return out;
}

/** job 區塊內依 `      - ` 切 step */
function stepsOf(jobText) {
  const steps = [];
  for (const line of jobText.split('\n')) {
    if (/^ {6}- /.test(line)) steps.push(line);
    else if (steps.length) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}
const stepNamed = (jobText, prefix) => {
  const s = stepsOf(jobText).find((x) => new RegExp(`^ {6}- name: ${prefix}`).test(x));
  assert.ok(s, `找不到步驟 ${prefix}`);
  return s;
};

/** 取出 step 裡的 run 內容（單行或 `|` 區塊），縮排還原 */
function runOf(step) {
  const lines = step.split('\n');
  const i = lines.findIndex((l) => /^ {8}run:/.test(l));
  if (i < 0) return null;
  const first = lines[i].replace(/^ {8}run:\s*/, '');
  if (!/^\|[-+]?$/.test(first)) return first;
  const body = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && !/^ {10}/.test(l)) break;
    body.push(l.replace(/^ {10}/, ''));
  }
  return body.join('\n');
}
const allRuns = (jobText) => stepsOf(jobText).map(runOf).filter(Boolean);
const noExpr = (s) => s.replace(/\$\{\{[^}]*\}\}/g, 'X');

const cp = jobsOf(read(`${WF_DIR}/content-pr.yml`));
const cpText = read(`${WF_DIR}/content-pr.yml`);

test('#81 content-pr：test job 只有 contents: read，lane job 才有寫入權限；PR 程式碼只在 test job 執行', () => {
  assert.deepEqual(Object.keys(cp), ['test', 'lane']);
  const t = cp.test;
  assert.match(t, /\n {4}permissions:\n {6}contents: read\n/);
  assert.ok(!/: write/.test(t), 'test job 不得有任何 write 權限');
  assert.ok(t.includes('persist-credentials: false'), 'checkout 不把權杖留在 .git/config');
  // 權杖只允許出現在「查 team」那一步（只跑 gh）；job 層級 env 不放 GH_TOKEN
  const withToken = stepsOf(t).filter((s) => s.includes('secrets.GITHUB_TOKEN'));
  assert.equal(withToken.length, 1);
  assert.ok(withToken[0].includes('Lookup author teams (gh only)'));
  const jobEnv = t.split(/\n {4}steps:\n/)[0];
  assert.ok(!jobEnv.includes('secrets.'), 'test job 層級 env 沒有權杖');
  // 執行 PR 程式碼的步驟都在 test job
  for (const needle of [
    'npm ci',
    'npm run lint',
    'npm run format:check',
    'npm run typecheck',
    'npm test',
    'node scripts/build.mjs --check',
    'npm run a11y',
    'node scripts/lane.mjs',
    'npm run build',
  ]) {
    assert.ok(t.includes(needle), `test job 缺 ${needle}`);
  }
  const l = cp.lane;
  assert.match(l, /(^|\n) {4}needs: test\n/);
  for (const p of ['contents: write', 'pull-requests: write', 'issues: write', 'actions: write']) assert.ok(l.includes(p), `lane job 缺 ${p}`);
  // 工作流程層級仍然唯讀
  assert.match(cpText.split(/\njobs:\n/)[0], /\npermissions:\n {2}contents: read\n/);
});

test('#81 content-pr：lane job 沒有 checkout、setup-node、npm、node、repo 內腳本；唯一的第三方 action 是釘 SHA 的 download-artifact', () => {
  const l = cp.lane;
  const uses = [...l.matchAll(/uses:\s*(\S+)(.*)/g)];
  assert.deepEqual(
    uses.map((m) => m[1]),
    ['actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333', 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333'],
  );
  for (const m of uses) assert.match(m[2], /#\s*v\d/);
  const lCode = l
    .split('\n')
    .filter((x) => !x.trim().startsWith('#'))
    .join('\n');
  assert.ok(!/actions\/checkout|setup-node|upload-artifact/.test(lCode));
  const runs = allRuns(l).join('\n---\n');
  // jq 程式（heredoc 內容）是給 jq 讀的資料，表格標題裡會出現「npm test」字樣；排除後再檢查 shell 指令
  const code = runs
    .replace(/<<'JQ'\n[\s\S]*?\n\s*JQ\n/g, '')
    .split('\n')
    .filter((x) => !x.trim().startsWith('#'))
    .join('\n');
  assert.ok(!/\bnpm\b|\bnpx\b|\bnode\b|\byarn\b|\bpnpm\b/.test(code), 'lane job 的 run 不得出現 npm／npx／node');
  assert.ok(!/(^|\s)(\.\/)?scripts\//m.test(code), 'lane job 不得呼叫 repo 內的 scripts/');
  assert.ok(!/\bsource\b|\bbash\s+[^-]|\bsh\s+[^-]/.test(code), 'lane job 不得 source／執行檔案');
  // 留言走 jq
  assert.ok(code.includes('jq -r -f "$RUNNER_TEMP/comment.jq"'));
  // 寫入權杖只在 lane job；artifact 內容要驗證
  assert.ok(l.includes('Validate results (artifact is untrusted data)'));
  // 結果不採用時的出口：留言 + 失敗
  assert.ok(l.includes('Comment when test job produced no usable results'));
  assert.match(l, /Fail when checks failed\n {8}if: always\(\) && \(steps\.load\.outputs\.ok != 'true'/);
});

test('#81 沒有任何工作流程使用 pull_request_target；preview-cleanup 權限在 job 層級', () => {
  for (const f of workflows) {
    const code = read(`${WF_DIR}/${f}`)
      .split('\n')
      .filter((x) => !x.trim().startsWith('#'))
      .join('\n');
    assert.ok(!code.includes('pull_request_target'), `${f} 不得使用 pull_request_target`);
  }
  const pc = read(`${WF_DIR}/preview-cleanup.yml`);
  assert.match(pc.split(/\njobs:\n/)[0], /\npermissions: \{\}\n/, '工作流程層級不給權限');
  const j = jobsOf(pc).cleanup;
  assert.match(j, /permissions:\n {6}contents: write[^\n]*\n {6}actions: write[^\n]*\n {6}pull-requests: read/);
});

test('#81 每個工作流程的每個 run 區塊通過 bash -n；步驟 id 與引用一致', () => {
  let n = 0;
  for (const f of workflows) {
    for (const [job, text] of Object.entries(jobsOf(read(`${WF_DIR}/${f}`)))) {
      for (const run of allRuns(text)) {
        const r = spawnSync('bash', ['-n'], { input: noExpr(run), encoding: 'utf8' });
        assert.equal(r.status, 0, `${f}:${job} 的 run 語法錯誤：\n${r.stderr}\n${run}`);
        n++;
      }
    }
  }
  assert.ok(n > 20, `檢查了 ${n} 個 run 區塊`);
  // steps.<id> 引用的 id 必須在同一個 job 內存在
  for (const [job, text] of Object.entries(cp)) {
    const ids = new Set([...text.matchAll(/^ {8}id: (\w+)/gm)].map((m) => m[1]));
    for (const m of text.matchAll(/steps\.(\w+)\./g)) assert.ok(ids.has(m[1]), `${job} 引用了不存在的 steps.${m[1]}`);
  }
  // lane job 引用的 needs
  assert.ok(!/needs\.test\.outputs/.test(cpText), '結果走 artifact，不用 job outputs');
});

// ───────── 實跑：驗證 artifact 的 bash 步驟（假的 gh） ─────────
function runValidate({ lane, result, realFiles, download = 'success' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r40-'));
  const D = path.join(tmp, 'result');
  fs.mkdirSync(D, { recursive: true });
  if (lane !== undefined) fs.writeFileSync(path.join(D, 'lane.json'), typeof lane === 'string' ? lane : JSON.stringify(lane));
  if (result !== undefined) fs.writeFileSync(path.join(D, 'result.json'), typeof result === 'string' ? result : JSON.stringify(result));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  // 假的 gh：`gh pr diff … --name-only` 印出 FAKE_FILES
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\nprintf "%s\\n" $FAKE_FILES\n', { mode: 0o755 });
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: tmp,
    GITHUB_ENV: path.join(tmp, 'env'),
    GITHUB_OUTPUT: path.join(tmp, 'out'),
    PR: '1',
    REPO: 'o/r',
    DOWNLOAD: download,
    FAKE_FILES: realFiles.join(' '),
  };
  fs.writeFileSync(env.GITHUB_ENV, '');
  fs.writeFileSync(env.GITHUB_OUTPUT, '');
  const script = runOf(stepNamed(cp.lane, 'Validate results'));
  const r = spawnSync('bash', ['-e', '-c', script], { env, encoding: 'utf8' });
  const kv = (f) =>
    Object.fromEntries(
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
  return { status: r.status, stdout: r.stdout, env: kv(env.GITHUB_ENV), out: kv(env.GITHUB_OUTPUT), tmp };
}
const goodLane = (files = ['content/news/x.json']) => ({
  lane: 'fast',
  ghLabel: 'lane:fast',
  autoMerge: true,
  requiredApprovals: 0,
  files: files.map((file) => ({ file, lane: 'fast' })),
});
const goodResult = (over = {}) => ({
  outcomes: {
    pii: 'success',
    lint: 'success',
    format: 'success',
    typecheck: 'success',
    test: 'success',
    check: 'success',
    a11y: 'success',
    preview_build: 'success',
    lane: 'success',
    ...over,
  },
  a11y: { warnings: 2, warningRules: { 'heading-order': 1, region: 1 } },
});

test('#81 驗證步驟（實跑）：正常結果被採用，值寫進 GITHUB_ENV；a11y 警告數與規則別次數帶出', () => {
  const r = runValidate({ lane: goodLane(), result: goodResult(), realFiles: ['content/news/x.json'] });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.out.ok, 'true');
  assert.deepEqual(
    { LANE: r.env.LANE, LABEL: r.env.LABEL, AUTO: r.env.AUTO, NEED: r.env.NEED, TEST: r.env.TEST, FORMAT: r.env.FORMAT, TYPECHECK: r.env.TYPECHECK },
    { LANE: 'fast', LABEL: 'lane:fast', AUTO: 'true', NEED: '0', TEST: 'success', FORMAT: 'success', TYPECHECK: 'success' },
  );
  assert.equal(r.env.A11Y_WARN, '2');
  assert.equal(r.env.A11Y_RULES, 'heading-order×1、region×1');
});

test('#81 驗證步驟（實跑）：少報檔案、不明車道、缺檔、artifact 沒下載到 ⇒ ok=false；夾帶換行的列舉值變 invalid 不會注入其他環境變數', () => {
  // lane.json 沒列出 PR 實際改到的 scripts/lane.mjs（想靠少報讓程式變更走快車道）
  let r = runValidate({ lane: goodLane(['content/news/x.json']), result: goodResult(), realFiles: ['content/news/x.json', 'scripts/lane.mjs'] });
  assert.equal(r.out.ok, 'false');
  assert.match(r.stdout, /漏了 PR 實際變更的檔/);
  // 多報沒關係（lane.json 涵蓋的是超集）
  r = runValidate({ lane: goodLane(['content/news/x.json', 'extra.json']), result: goodResult(), realFiles: ['content/news/x.json'] });
  assert.equal(r.out.ok, 'true');
  // 不明車道、不合法標籤、非布林、非整數
  for (const bad of [{ lane: 'god-mode' }, { ghLabel: 'lane:fast\nPATH=/evil' }, { autoMerge: 'yes' }, { requiredApprovals: 12 }]) {
    r = runValidate({ lane: { ...goodLane(), ...bad }, result: goodResult(), realFiles: ['content/news/x.json'] });
    assert.equal(r.out.ok, 'false', JSON.stringify(bad));
  }
  // 缺檔／壞 JSON／沒下載到
  assert.equal(runValidate({ lane: goodLane(), realFiles: [] }).out.ok, 'false');
  assert.equal(runValidate({ lane: '{oops', result: goodResult(), realFiles: [] }).out.ok, 'false');
  assert.equal(runValidate({ lane: goodLane(), result: goodResult(), realFiles: ['content/news/x.json'], download: 'failure' }).out.ok, 'false');
  // outcome 夾帶換行與其他變數：變成 invalid，不寫出額外的 GITHUB_ENV 行
  r = runValidate({ lane: goodLane(), result: goodResult({ test: 'success\nGH_TOKEN=stolen', lint: 'passed' }), realFiles: ['content/news/x.json'] });
  assert.equal(r.out.ok, 'true');
  assert.equal(r.env.TEST, 'invalid');
  assert.equal(r.env.LINT, 'invalid');
  assert.ok(!('GH_TOKEN' in r.env), '不可能夾帶其他變數');
  // 規則 id 含奇怪字元的警告被丟掉
  r = runValidate({
    lane: goodLane(),
    result: { ...goodResult(), a11y: { warnings: '3; rm -rf', warningRules: { 'a b\nX=1': 1, ok: 2 } } },
    realFiles: ['content/news/x.json'],
  });
  assert.equal(r.env.A11Y_WARN, '0');
  assert.equal(r.env.A11Y_RULES, 'ok×2');
});

// ───────── 實跑：留言的 jq 程式 ─────────
function commentWith(env, lane) {
  const step = stepNamed(cp.lane, 'Comment on PR');
  const m = runOf(step).match(/<<'JQ'\n([\s\S]*?)\nJQ\n/);
  assert.ok(m, '找不到 jq heredoc');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r40jq-'));
  fs.writeFileSync(path.join(tmp, 'c.jq'), m[1]);
  fs.writeFileSync(path.join(tmp, 'lane.json'), JSON.stringify(lane));
  const r = spawnSync('jq', ['-r', '-f', path.join(tmp, 'c.jq'), path.join(tmp, 'lane.json')], { env: { ...process.env, ...env }, encoding: 'utf8' });
  return r;
}
const hasJq = spawnSync('jq', ['--version']).status === 0;
test('#81 留言（jq 實跑）：表格有格式、型別列；a11y 警告數與規則別次數出現；blocked／merge 文案正確', { skip: !hasJq && '本機沒有 jq' }, () => {
  const lane = spawnSync('node', ['scripts/lane.mjs', '--author=ancientsky', 'docs/deploy.md'], { cwd: ROOT, encoding: 'utf8', input: '' });
  const L = JSON.parse(lane.stdout);
  const base = {
    TEST: 'success',
    LINT: 'success',
    FORMAT: 'success',
    TYPECHECK: 'success',
    CHECK: 'success',
    A11Y: 'success',
    PII: 'success',
    PREVIEW_BUILD: 'success',
    PREVIEW_PUSH: 'success',
    PREVIEW_URL: 'https://x.github.io/r/preview/pr-1/',
    RUN_URL: 'https://x/run/1',
    ACTION: 'wait',
    APPROVALS: '0',
    A11Y_WARN: '3',
    A11Y_RULES: 'region×2、heading-order×1',
  };
  const ok = commentWith(base, L);
  assert.equal(ok.status, 0, ok.stderr);
  const md = ok.stdout;
  assert.ok(md.startsWith('<!-- lane-bot -->'));
  for (const row of ['| 測試（npm test） | ✅ 通過 |', '| Lint（eslint） | ✅ 通過 |', '| 格式（prettier', '| 型別檢查（tsc', '| 個資掃描（'])
    assert.ok(md.includes(row), row);
  assert.ok(md.includes('✅ 通過（另有 3 項 moderate／minor 警告，不擋合併：region×2、heading-order×1）'), '無障礙列帶出警告數');
  assert.ok(md.includes('⏳ 等待審核：需 1 位核准（目前 0）'));
  assert.ok(md.includes('[https://x.github.io/r/preview/pr-1/](https://x.github.io/r/preview/pr-1/)'));
  assert.ok(md.includes(`車道判定依據（${L.files.length} 個檔案）`));
  const blocked = commentWith({ ...base, ACTION: 'blocked', FORMAT: 'failure', A11Y_WARN: '0', PREVIEW_PUSH: 'skipped' }, L).stdout;
  assert.ok(
    blocked.includes('❌ 檢查未通過，不合併') &&
      blocked.includes('| 格式（prettier，放行清單內的新檔） | ❌ 失敗 |') &&
      blocked.includes('| 預覽網址 | 未產生 |'),
  );
  assert.ok(!blocked.includes('moderate／minor'), '沒有警告就不加括號');
  const merge = commentWith({ ...base, ACTION: 'merge' }, { ...L, autoMerge: true, requiredApprovals: 0 }).stdout;
  assert.ok(merge.includes('自動合併（squash），約 3 分鐘後上線'));
});

// ───────── #82 格式與型別檢查 ─────────
test('#82 content-pr 與 pages 都跑 format:check 與 typecheck，結果進留言表格與 blocked 判斷', () => {
  const pages = read(`${WF_DIR}/pages.yml`);
  assert.ok(pages.includes('npm run format:check') && pages.includes('npm run typecheck'));
  for (const id of ['format', 'typecheck']) {
    assert.ok(new RegExp(`id: ${id}\\n\\s+continue-on-error: true`).test(cp.test), `${id} 步驟不能中斷後面的步驟`);
    assert.ok(cp.test.includes(`steps.${id}.outcome != 'success'`), `${id} 進 test job 的失敗判斷`);
  }
  const decide = runOf(stepNamed(cp.lane, 'Decide merge'));
  assert.ok(decide.includes('"$FORMAT" != "success"') && decide.includes('"$TYPECHECK" != "success"'));
  assert.ok(cp.lane.includes('env.FORMAT != ') && cp.lane.includes('env.TYPECHECK != '));
});

test('#82 tsconfig：include 的 src/client/answer 檔都有 // @ts-check；checkJs 為 false（只檢查有標記的檔，不會被 import 拖進整個答案引擎）', () => {
  const raw = read('tsconfig.json');
  const cfg = JSON.parse(raw);
  assert.equal(cfg.compilerOptions.checkJs, false);
  const answer = cfg.include.filter((p) => p.startsWith('src/client/answer/'));
  assert.deepEqual(answer.sort(), [
    'src/client/answer/factcheck.js',
    'src/client/answer/inline.js',
    'src/client/answer/llm-key.js',
    'src/client/answer/stats.js',
  ]);
  for (const f of answer) assert.ok(read(f).startsWith('// @ts-check\n'), `${f} 檔首要有 // @ts-check`);
  assert.ok(cfg.include.includes('src/client/globals.d.ts'));
  const r = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});

test('#82 本輪新增的測試檔在 .prettierignore 放行清單；deploy.md 寫了擴大順序與 pull_request_target 警告', () => {
  assert.ok(read('.prettierignore').split('\n').includes('!tests/round40-ci-isolation.test.mjs'));
  const d = read('docs/deploy.md');
  assert.ok(d.includes('第四十輪'));
  assert.ok(d.includes('pull_request_target'));
  for (const f of ['render.js', 'data.js', 'ui.js', 'core.js']) assert.ok(d.includes(f), `擴大順序要提到 ${f}`);
});

// ───────── #83 a11y 殘留 ─────────
test('#83 /admin/：示範提示在地標內（aside 有名稱，不再是地標外的 role=note div）；nav 與 footer 是原生元素', () => {
  const src = read('src/templates/admin/_layout.mjs');
  assert.ok(/<aside class="adm-demo" aria-label="[^"]+">/.test(src));
  assert.ok(!/<div class="adm-demo"/.test(src) && !src.includes('role="note"'));
  assert.ok(src.includes('<nav class="adm-nav" aria-label=') && src.includes('<footer class="adm-foot">') && src.includes('<main id="main"'));
});

test('#83 /ask/ 答案卡：疫情卡標題是 h2（緊接 sr-only h1，h3 會跳級）；a11y 腳本掃 /ask/?q=、/admin/、/admin/publish/，並輸出 moderate 警告數', () => {
  const render = read('src/client/answer/render.js');
  const sit = render.slice(render.indexOf('export async function situationCards'), render.indexOf('c-answer__situation" aria-label'));
  assert.match(sit, /<header><h2>/);
  assert.ok(!/<h3>/.test(sit), '疫情卡不再用 h3');
  assert.ok(read('src/styles/answer.css').includes('.ask-page .c-answer-sit h2{'));
  const a = read('scripts/a11y.mjs');
  for (const p of ["'/admin/'", "'/admin/publish/'", "'/ask/?q=%E7%99%BB%E9%9D%A9%E7%86%B1'"]) assert.ok(a.includes(p), p);
  assert.ok(a.includes('A11Y_JSON') && a.includes('warningRules') && a.includes('[a11y] 阻擋'));
  const wf = cp.test;
  assert.ok(wf.includes('A11Y_JSON: ${{ runner.temp }}/a11y-summary.json'));
});
