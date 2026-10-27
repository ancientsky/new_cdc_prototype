// 第六十輪（Issue #124）：main 的規則集（ruleset）匯入檔。
// 規則集是 GitHub 的設定、不在 repo 裡生效；這裡放一份可匯入的 JSON，讓「正式環境要設什麼」有一個可版本控制、可審核的正本。
// 測試只驗證檔案本身與工作流程的對應（必要狀態檢查的名稱必須是 content-pr.yml 真的會回報的 job；核准人數交給車道機器人）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('#124 .github/rulesets/main.json：禁止直接 push／force push／刪除，合併前必過 test 檢查；核准人數為 0（由車道決定）；Actions app 可繞過（排程回寫快照）', () => {
  const rs = JSON.parse(read('.github/rulesets/main.json'));
  assert.equal(rs.target, 'branch');
  assert.equal(rs.enforcement, 'active');
  assert.deepEqual(rs.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  const types = rs.rules.map((r) => r.type);
  for (const t of ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']) assert.ok(types.includes(t), t);
  const pr = rs.rules.find((r) => r.type === 'pull_request').parameters;
  // 不設原生的「需 N 位核准」：快車道、緊急發布是 0 位，一般車道由 lane job 數核准（docs/deploy.md §2「分支保護與自動合併互相牴觸」）
  assert.equal(pr.required_approving_review_count, 0);
  assert.ok(pr.allowed_merge_methods.includes('squash'), 'lane job 用 squash 合併');
  const checks = rs.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
  // 必要狀態檢查要用 test job，不能用 lane job：lane job 自己呼叫 gh pr merge 時還在執行中，要求它成功會把自己擋住
  assert.deepEqual(checks, ['test']);
  const cp = read('.github/workflows/content-pr.yml');
  // 第六十八輪：jobs 前面多了只在審核事件跑的 reuse job；必要檢查仍是 test（它被略過時 GitHub 視為通過，同一 commit 先前的 test 已成功）
  assert.match(cp, /^  test:\n/m, 'content-pr.yml 有叫 test 的 job');
  assert.ok(!checks.includes('lane'));
  // 繞過名單留空：匯入時帶 GitHub Actions app（Integration 15368）會被拒「invalid actor」，而且介面的繞過名單也沒有 GitHub Actions（2026-10-25 實測）。
  // 回寫快照改走「部署金鑰」（可列入繞過）：有 SNAPSHOT_DEPLOY_KEY 就經 SSH 推；沒有就用 token 試推；兩條路失敗都只警告不讓建置失敗。
  assert.deepEqual(rs.bypass_actors, []);
  const pages = read('.github/workflows/pages.yml');
  assert.ok(pages.includes('SNAPSHOT_DEPLOY_KEY: ${{ secrets.SNAPSHOT_DEPLOY_KEY }}'));
  assert.ok(
    pages.includes('git@github.com:${GITHUB_REPOSITORY}.git') && pages.includes('IdentitiesOnly=yes') && pages.includes('ssh-keyscan -t ed25519 github.com'),
  );
  assert.ok(pages.includes('rm -f "$RUNNER_TEMP/snapshot_key"'), '私鑰用完就刪');
  assert.ok(pages.includes('elif git push origin HEAD:main; then'));
  // 2026-10-25 run #328：fetch 也改 content/datasets/，沒 add 進去 ⇒ git pull --rebase 以「You have unstaged changes」失敗、整個建置紅掉。
  assert.ok(pages.includes('git add -A data/snapshots content/datasets'), '快照與 fetch 改到的資料目錄一起提交');
  assert.ok(pages.includes('git pull --rebase --autostash origin main'), 'rebase 前自動 stash 其他未提交變更');
  assert.match(pages, /if ! git pull --rebase --autostash origin main; then\n\s+echo "::warning::/, 'rebase 失敗只警告、不讓建置失敗');
  assert.equal((pages.match(/::warning::[^\n]*規則集/g) || []).length, 2, '兩條路失敗都只警告');
  assert.ok(!/SNAPSHOT_DEPLOY_KEY/.test(read('.github/workflows/content-pr.yml')), 'PR 的工作流程不能拿到部署金鑰');
  // 文件有匯入步驟
  const deploy = read('docs/deploy.md');
  assert.ok(deploy.includes('.github/rulesets/main.json') && deploy.includes('Import a ruleset'));
});
