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
function runValidate({ lane, result, realFiles, prevFiles = [], count, download = 'success' }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r40-'));
  const D = path.join(tmp, 'result');
  fs.mkdirSync(D, { recursive: true });
  if (lane !== undefined) fs.writeFileSync(path.join(D, 'lane.json'), typeof lane === 'string' ? lane : JSON.stringify(lane));
  if (result !== undefined) fs.writeFileSync(path.join(D, 'result.json'), typeof result === 'string' ? result : JSON.stringify(result));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  // 假的 gh（第五十六輪改為檔案 API）：`gh api …/pulls/N/files --jq …` 印出 jq 處理後的樣子（f 新路徑、p 改名前路徑），
  // `gh pr view --json changedFiles` 印出變更檔數（預設＝FAKE_FILES 的個數）
  fs.writeFileSync(
    path.join(bin, 'gh'),
    [
      '#!/bin/bash',
      'case "$*" in',
      '  *"/files"*) for f in $FAKE_FILES; do echo "f $f"; done; for p in $FAKE_PREV; do echo "p $p"; done ;;',
      '  *changedFiles*) if [ -n "$FAKE_COUNT" ]; then echo "$FAKE_COUNT"; else set -- $FAKE_FILES; echo "$#"; fi ;;',
      '  *) printf "%s\\n" $FAKE_FILES ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    RUNNER_TEMP: tmp,
    GITHUB_ENV: path.join(tmp, 'env'),
    GITHUB_OUTPUT: path.join(tmp, 'out'),
    PR: '1',
    REPO: 'o/r',
    DOWNLOAD: download,
    FAKE_FILES: realFiles.join(' '),
    FAKE_PREV: prevFiles.join(' '),
    FAKE_COUNT: count === undefined ? '' : String(count),
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
  // 第五十六輪：全部檢查都跑而且通過 ⇒ 閘門 pass；沒跑 test:content 但完整 npm test 通過 ⇒ covered
  assert.equal(r.env.GATE, 'pass');
  assert.equal(r.env.CONTENT_ONLY, 'true');
  assert.equal(r.env.CONTENT_TEST, 'covered');
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
    // 第五十六輪：中間多了「純內容 PR 跳過」的 if
    assert.ok(
      new RegExp(`id: ${id}\\n\\s+if: steps\\.scope\\.outputs\\.content_only != 'true'\\n\\s+continue-on-error: true`).test(cp.test),
      `${id} 步驟不能中斷後面的步驟`,
    );
    assert.ok(cp.test.includes(`steps.${id}.outcome != 'success'`), `${id} 進 test job 的失敗判斷`);
  }
  // 第五十六輪：lane job 的擋合併與失敗只看 Validate results 算出的 GATE；format、typecheck 在 GATE 的檢查清單裡
  const validate = runOf(stepNamed(cp.lane, 'Validate results'));
  assert.ok(validate.includes('for k in lint format typecheck test a11y content_test; do'));
  const decide = runOf(stepNamed(cp.lane, 'Decide merge'));
  assert.ok(decide.includes('elif [ "$GATE" != "pass" ]; then ACTION=blocked'));
  assert.match(cp.lane, /Fail when checks failed\n {8}if: always\(\) && \(steps\.load\.outputs\.ok != 'true' \|\| env\.GATE != 'pass'\)\n/);
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

// ───────── 第五十六輪：純內容分流、一次建置、Chromium 快取（docs/deploy.md 第 28 節） ─────────
const contentLane = (files) => ({ ...goodLane(files), lane: 'standard', ghLabel: 'lane:standard', autoMerge: false, requiredApprovals: 1 });
/** 純內容 PR 的 test job 結果：程式檢查 skipped、內容測試 success */
const contentResult = (over = {}) => ({
  scope: 'content',
  ...goodResult({ lint: 'skipped', format: 'skipped', typecheck: 'skipped', test: 'skipped', a11y: 'skipped', content_test: 'success', ...over }),
});

test('#56 驗證步驟（實跑）：純內容 PR 被略過的程式檢查記為 content-skip、閘門 pass；內容測試沒跑或失敗 ⇒ fail', () => {
  const files = ['content/news/x.json', 'data/snapshots/travel.json'];
  let r = runValidate({ lane: goodLane(files), result: contentResult(), realFiles: files });
  assert.equal(r.out.ok, 'true', r.stdout);
  assert.equal(r.env.CONTENT_ONLY, 'true');
  for (const k of ['LINT', 'FORMAT', 'TYPECHECK', 'TEST', 'A11Y']) assert.equal(r.env[k], 'content-skip', k);
  assert.equal(r.env.CONTENT_TEST, 'success');
  assert.equal(r.env.GATE, 'pass');
  // 內容測試沒跑（skipped）、失敗、取消 ⇒ 閘門 fail（純內容 PR 至少要有一次真的測試通過）
  for (const ct of ['skipped', 'failure', 'cancelled']) {
    r = runValidate({ lane: goodLane(files), result: contentResult({ content_test: ct }), realFiles: files });
    assert.equal(r.env.GATE, 'fail', ct);
  }
  // 個資掃描與治理閘門不能略過
  for (const k of ['pii', 'check']) {
    r = runValidate({ lane: goodLane(files), result: contentResult({ [k]: 'skipped' }), realFiles: files });
    assert.equal(r.env.GATE, 'fail', k);
  }
  // 純內容 PR 但 test job 全跑了（例如兩邊判定不同）：npm test 通過就算 covered
  r = runValidate({ lane: goodLane(files), result: goodResult(), realFiles: files });
  assert.equal(r.env.CONTENT_TEST, 'covered');
  assert.equal(r.env.GATE, 'pass');
  // 純內容 PR 裡真的失敗的程式檢查仍是失敗（content-skip 只給 skipped）
  r = runValidate({ lane: goodLane(files), result: contentResult({ lint: 'failure' }), realFiles: files });
  assert.equal(r.env.LINT, 'failure');
  assert.equal(r.env.GATE, 'fail');
});

test('#56 驗證步驟（實跑）：程式 PR 偽造「純內容」——artifact 的 scope、略過的檢查、content-skip 字樣都不能讓閘門 pass', () => {
  // PR 實際改到 scripts/：artifact 說 scope=content、程式檢查都 skipped ⇒ skipped 照算失敗
  const files = ['content/news/x.json', 'scripts/lane.mjs'];
  let r = runValidate({ lane: contentLane(files), result: contentResult(), realFiles: files });
  assert.equal(r.out.ok, 'true');
  assert.equal(r.env.CONTENT_ONLY, 'false');
  assert.equal(r.env.LINT, 'skipped');
  assert.equal(r.env.GATE, 'fail');
  assert.match(r.stdout, /test job 判定為純內容，但 PR 實際含程式／文件變更/);
  // .github/、package.json、docs/、tests/、名字像 content 的其他目錄也都不是純內容
  for (const f of ['.github/workflows/content-pr.yml', 'package.json', 'docs/deploy.md', 'tests/x.test.mjs', 'contentx/a.json', 'data/other.json']) {
    r = runValidate({ lane: contentLane(['content/news/x.json', f]), result: contentResult(), realFiles: ['content/news/x.json', f] });
    assert.equal(r.env.GATE, 'fail', f);
  }
  // 改名：scripts/lane.mjs → content/news/y.json。API 的新路徑在 content/，舊路徑（previous_filename）在 scripts/ ⇒ 不是純內容
  r = runValidate({
    lane: contentLane(['content/news/y.json', 'scripts/lane.mjs']),
    result: contentResult(),
    realFiles: ['content/news/y.json'],
    prevFiles: ['scripts/lane.mjs'],
  });
  assert.equal(r.env.CONTENT_ONLY, 'false');
  assert.equal(r.env.GATE, 'fail');
  // 同一個改名、lane.json 沒列舊路徑 ⇒ 少報檔案，整份不採用
  r = runValidate({ lane: contentLane(['content/news/y.json']), result: contentResult(), realFiles: ['content/news/y.json'], prevFiles: ['scripts/lane.mjs'] });
  assert.equal(r.out.ok, 'false');
  // artifact 直接寫 content-skip／covered：先被列舉檢查變成 invalid（只有驗證步驟自己能產生這兩個值）
  r = runValidate({
    lane: goodLane(['content/news/x.json']),
    result: goodResult({ test: 'content-skip', lint: 'covered', content_test: 'covered' }),
    realFiles: ['content/news/x.json'],
  });
  assert.equal(r.env.TEST, 'invalid');
  assert.equal(r.env.LINT, 'invalid');
  assert.equal(r.env.CONTENT_TEST, 'invalid');
  assert.equal(r.env.GATE, 'fail');
  // 程式 PR 全部通過、沒跑 test:content ⇒ covered、pass
  r = runValidate({ lane: contentLane(files), result: goodResult(), realFiles: files });
  assert.equal(r.env.CONTENT_TEST, 'covered');
  assert.equal(r.env.GATE, 'pass');
  // 程式 PR 的 npm test 失敗：content_test 不會變 covered
  r = runValidate({ lane: contentLane(files), result: goodResult({ test: 'failure' }), realFiles: files });
  assert.equal(r.env.CONTENT_TEST, 'skipped');
  assert.equal(r.env.GATE, 'fail');
  // 檔案 API 列不完（PR 的 changedFiles 比列出的多）⇒ 無法驗證，不採用；沒有變更檔 ⇒ 不是純內容
  r = runValidate({ lane: goodLane(['content/news/x.json']), result: contentResult(), realFiles: ['content/news/x.json'], count: 3001 });
  assert.equal(r.out.ok, 'false');
  assert.match(r.stdout, /只列出 1／3001 個變更檔/);
  r = runValidate({ lane: goodLane([]), result: contentResult(), realFiles: [] });
  assert.equal(r.env.CONTENT_ONLY, 'false');
  assert.equal(r.env.GATE, 'fail');
  // 驗證不過時 GITHUB_ENV 一個值都不寫（GATE 不存在，後面的步驟只看得到 ok=false）
  r = runValidate({ lane: { ...goodLane(), lane: 'god-mode' }, result: contentResult(), realFiles: ['content/news/x.json'] });
  assert.equal(r.out.ok, 'false');
  assert.deepEqual(r.env, {});
});

/** 實跑 Decide merge（假的 gh 回傳核准數） */
function runDecide(env) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r56d-'));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho "${FAKE_APPROVALS:-0}"\n', { mode: 0o755 });
  const out = path.join(tmp, 'out');
  fs.writeFileSync(out, '');
  const base = { PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, PR: '1', REPO: 'o/r', STATE: 'open', DRAFT: 'false', AUTO: 'true', NEED: '0' };
  const r = spawnSync('bash', ['-e', '-c', runOf(stepNamed(cp.lane, 'Decide merge'))], { env: { ...base, ...env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries(
    fs
      .readFileSync(out, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('=')),
  ).action;
}

test('#56 Decide merge（實跑）：只看 GATE；GATE 不是 pass（含沒設）一律 blocked；合併只合檢查過的 head', () => {
  assert.equal(runDecide({ GATE: 'pass' }), 'merge');
  assert.equal(runDecide({ GATE: 'fail' }), 'blocked');
  assert.equal(runDecide({}), 'blocked');
  // 個別 outcome 怎麼寫都不影響（舊版看 TEST／LINT…，現在只看 GATE）
  assert.equal(runDecide({ GATE: 'fail', TEST: 'success', LINT: 'success', PII: 'success' }), 'blocked');
  assert.equal(runDecide({ GATE: 'pass', AUTO: 'false', NEED: '1', FAKE_APPROVALS: '0' }), 'wait');
  assert.equal(runDecide({ GATE: 'pass', AUTO: 'false', NEED: '1', FAKE_APPROVALS: '1' }), 'merge');
  assert.equal(runDecide({ GATE: 'pass', DRAFT: 'true' }), 'draft');
  const merge = stepNamed(cp.lane, 'Merge \\(squash\\)');
  assert.ok(runOf(merge).includes('--match-head-commit "$HEAD_SHA"'));
  assert.ok(merge.includes('HEAD_SHA: ${{ github.event.pull_request.head.sha }}'));
});

test(
  '#56 留言（jq 實跑）：純內容 PR 顯示「略過（純內容變更）」與內容測試；程式 PR 的內容測試列為「已含在 npm test」；程式 PR 審核人是 OASIS',
  { skip: !hasJq && '本機沒有 jq' },
  () => {
    const lane = (args) =>
      JSON.parse(spawnSync('node', ['scripts/lane.mjs', '--author=ancientsky', ...args], { cwd: ROOT, encoding: 'utf8', input: '' }).stdout);
    const common = {
      CHECK: 'success',
      PII: 'success',
      PREVIEW_BUILD: 'success',
      PREVIEW_PUSH: 'success',
      PREVIEW_URL: 'https://x/p/',
      RUN_URL: 'https://x/run',
      ACTION: 'merge',
      APPROVALS: '0',
    };
    const skip = { LINT: 'content-skip', FORMAT: 'content-skip', TYPECHECK: 'content-skip', TEST: 'content-skip', A11Y: 'content-skip' };
    const md = commentWith(
      { ...common, ...skip, CONTENT_TEST: 'success', CONTENT_ONLY: 'true' },
      lane(['content/news/2026-09-18-flu-antiviral-extended.json']),
    ).stdout;
    for (const row of [
      '| 變更範圍 | 純內容（content/、data/snapshots/）',
      '| 測試（npm test） | ⏭ 略過（純內容變更） |',
      '| Lint（eslint） | ⏭ 略過（純內容變更） |',
      '| 無障礙檢測（axe） | ⏭ 略過（純內容變更） |',
      '| 內容測試（npm run test:content） | ✅ 通過 |',
    ])
      assert.ok(md.includes(row), row);
    assert.ok(!md.includes('❌'), '略過不顯示成失敗');
    const code = commentWith(
      {
        ...common,
        LINT: 'success',
        FORMAT: 'success',
        TYPECHECK: 'success',
        TEST: 'success',
        A11Y: 'success',
        CONTENT_TEST: 'covered',
        CONTENT_ONLY: 'false',
        ACTION: 'wait',
      },
      lane(['scripts/lane.mjs', 'docs/deploy.md']),
    ).stdout;
    assert.ok(code.includes('| 變更範圍 | 含程式／文件：全部檢查 |'));
    assert.ok(code.includes('| 內容測試（npm run test:content） | —（已含在 npm test） |'));
    assert.ok(code.includes('| 審核人 | AI推動辦公室（@ancientsky） |'), '程式／文件 PR 的審核人是 OASIS，不是公關室');
  },
);

test('#56 test job 結構：分流在 npm ci 之前；程式檢查只在程式 PR、test:content 只在純內容 PR；只建一次站，axe 掃預覽 dist', () => {
  const steps = stepsOf(cp.test);
  const idx = (re) => steps.findIndex((s) => re.test(s));
  assert.ok(idx(/id: scope\n/) > 0 && idx(/id: scope\n/) < idx(/run: npm ci/), '分流判斷在 npm ci（第一個執行 PR 程式碼的步驟）之前');
  const scope = runOf(stepNamed(cp.test, 'Classify changes'));
  assert.ok(scope.includes('git diff --name-only --no-renames origin/main...HEAD'));
  assert.ok(scope.includes("grep -Ev '^(content|data/snapshots)/'"));
  for (const id of ['lint', 'format', 'typecheck', 'test', 'a11y_browser', 'pw']) {
    const s = steps.find((x) => new RegExp(`id: ${id}\\n`).test(x));
    assert.ok(s && s.includes("if: steps.scope.outputs.content_only != 'true'"), `${id} 只在程式 PR 跑`);
  }
  assert.ok(stepNamed(cp.test, 'Accessibility check').includes("if: steps.scope.outputs.content_only != 'true' && steps.preview_build.outcome == 'success'"));
  assert.ok(stepNamed(cp.test, 'Content tests').includes("if: steps.scope.outputs.content_only == 'true'"));
  assert.equal(runOf(stepNamed(cp.test, 'Content tests')), 'npm run test:content');
  // 只建一次（--check 不算完整建置）；沒有 a11y 專用的 BASE_PATH='' 建置
  const builds = allRuns(cp.test).filter((r) => /npm run build|node scripts\/build\.mjs(?! --check)/.test(r));
  assert.deepEqual(builds, ['npm run build']);
  assert.ok(!cp.test.includes('a11y-dist'));
  const a11y = stepNamed(cp.test, 'Accessibility check');
  const preview = stepNamed(cp.test, 'Build preview');
  assert.ok(a11y.includes('DIST_DIR: ${{ runner.temp }}/preview-dist') && preview.includes('DIST_DIR: ${{ runner.temp }}/preview-dist'));
  const base = 'BASE_PATH: /${{ github.event.repository.name }}/preview/pr-${{ github.event.pull_request.number }}';
  assert.ok(a11y.includes(base) && preview.includes(base), 'axe 用與預覽建置相同的 BASE_PATH');
  assert.ok(idx(/id: preview_build\n/) < idx(/id: a11y\n/));
  // 審核事件：純內容 PR 不建；程式 PR 要建（給 axe）；預覽 dist 只在 pull_request 事件上傳
  assert.ok(preview.includes("(github.event_name == 'pull_request' || steps.scope.outputs.content_only != 'true')"));
  assert.ok(stepNamed(cp.test, 'Upload preview dist').includes("github.event_name == 'pull_request'"));
  // 結果帶 content_test 與 scope
  const collect = runOf(stepNamed(cp.test, 'Collect results'));
  assert.ok(collect.includes('content_test: $content_test') && collect.includes('scope: $scope'));
});

test('#56 Chromium 快取：PR 只還原（actions/cache/restore）、main 的 pages.yml 才存；key 用 playwright-core 版本；同一個 SHA', () => {
  const SHA = '55cc8345863c7cc4c66a329aec7e433d2d1c52a9';
  const key = 'key: playwright-chromium-${{ runner.os }}-${{ steps.pw.outputs.version }}';
  assert.ok(cpText.includes(`uses: actions/cache/restore@${SHA} # v6.1.0`));
  assert.ok(!/uses: actions\/cache@/.test(cpText), 'content-pr 不寫入快取（PR 的程式碼不能存別人會還原的快取）');
  assert.ok(cpText.includes(key) && cpText.includes('path: ~/.cache/ms-playwright'));
  const pages = read(`${WF_DIR}/pages.yml`);
  assert.ok(pages.includes(`uses: actions/cache@${SHA} # v6.1.0`));
  assert.ok(pages.includes(key) && pages.includes('path: ~/.cache/ms-playwright'));
  assert.ok(pages.includes("if: steps.pwcache.outputs.cache-hit != 'true'"));
  for (const t of [cpText, pages]) assert.ok(t.includes('.packages["node_modules/playwright-core"].version') && t.includes("tr -cd '0-9A-Za-z.-'"));
  // 仍然跑 playwright install（有快取時只補系統套件）
  assert.ok(cpText.includes('npx playwright install --with-deps chromium'));
  // lockfile 裡真的有 playwright-core
  assert.ok(JSON.parse(read('package-lock.json')).packages['node_modules/playwright-core'].version);
});

test('#56 test:content：清單裡的檔都存在、不含瀏覽器／伺服器／閘道測試；每個檔都寫在 docs/deploy.md 第 28 節', () => {
  const pkg = JSON.parse(read('package.json'));
  const cmd = pkg.scripts['test:content'];
  assert.ok(cmd.startsWith('node --test --import ./tests/pin-env.mjs '), '與 npm test 一樣先釘環境變數');
  const files = cmd.split(/\s+/).filter((x) => x.startsWith('tests/') && x.endsWith('.test.mjs'));
  assert.ok(files.length >= 15, `${files.length} 個檔`);
  const deploy = read('docs/deploy.md');
  const sec = deploy.slice(deploy.indexOf('## 28.'));
  assert.ok(deploy.includes('## 28.') && sec.length > 100, 'deploy.md 有第 28 節');
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} 不存在`);
    const src = read(f);
    assert.ok(!/playwright|chromium|createServer|serve\.mjs|scripts\/gateway|lib\/gateway/.test(src), `${f} 不能是瀏覽器、伺服器或閘道測試`);
    assert.ok(sec.includes(path.basename(f)), `docs/deploy.md 第 28 節要列出 ${path.basename(f)}`);
  }
  assert.equal(new Set(files).size, files.length, '不重複');
});
