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
  assert.match(cp, /^jobs:\n  test:\n/m, 'content-pr.yml 的第一個 job 叫 test');
  assert.ok(!checks.includes('lane'));
  // GitHub Actions app（id 15368）可繞過：pages.yml 的排程會把官方資料快照直接 push 回 main
  assert.deepEqual(rs.bypass_actors, [{ actor_id: 15368, actor_type: 'Integration', bypass_mode: 'always' }]);
  assert.ok(read('.github/workflows/pages.yml').includes('git push origin HEAD:main'));
  // 文件有匯入步驟
  const deploy = read('docs/deploy.md');
  assert.ok(deploy.includes('.github/rulesets/main.json') && deploy.includes('Import a ruleset'));
});
