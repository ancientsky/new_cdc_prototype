// 本機寫入閘道 → 工作目錄（第五十輪）：把 .local/gateway-repo（npm run dev 時閘道寫入的本機版本庫）main 上已核准上線的內容，
// 帶回這個工作目錄的 content/，再建置一次，本機站台才看得到核准的結果（例如重新審閱後最後審閱日更新、回到 AI 白名單）。
//
// 為什麼需要：正式環境的閘道寫進 GitLab，GitLab CI 從 main 建置，核准後網站自動更新；
// 原型的閘道寫進本機 bare repo，而 npm run dev／npm run build 讀的是工作目錄的 content/——兩邊不會自己同步。
// 這支只給本機示範用；正式環境不需要（docs/deploy.md §21）。
//
// 用法：
//   node scripts/gateway-pull.mjs           列出 main 上與工作目錄不同的內容檔（不寫入）
//   node scripts/gateway-pull.mjs --write   寫入工作目錄的 content/（之後 npm run build 或重開 npm run dev）
// 只看「閘道建庫以來 main 上改過的 content/ 檔」，不會動到你在工作目錄裡其他還沒送審的修改。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/load.mjs';

const dir = path.resolve(ROOT, process.env.GATEWAY_REPO_DIR || '.local/gateway-repo');
const write = process.argv.includes('--write');
const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!fs.existsSync(path.join(dir, 'HEAD'))) {
  console.log(`找不到本機閘道版本庫（${path.relative(ROOT, dir)}）：還沒用 npm run dev 在後台存過草稿或送審。`);
  process.exit(0);
}
const seed = git(['rev-list', '--max-parents=0', 'main']).trim().split('\n')[0];
const changed = git(['diff', '--name-only', seed, 'main', '--', 'content/']).split('\n').filter(Boolean);
const differs = [];
for (const rel of changed) {
  const target = path.join(ROOT, rel);
  let onMain = null;
  try { onMain = execFileSync('git', ['-C', dir, 'show', `main:${rel}`], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { onMain = null; }
  const local = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if (onMain == null || (local && Buffer.compare(local, onMain) === 0)) continue;
  differs.push(rel);
  if (write) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, onMain); }
}
if (!differs.length) console.log('工作目錄已與本機閘道 main 一致，不用更新。');
else {
  console.log(`${write ? '已寫入' : '與本機閘道 main 不同（加 --write 寫入）'} ${differs.length} 個檔：`);
  for (const f of differs) console.log(`  ${f}`);
  if (write) console.log('下一步：npm run build（或重開 npm run dev），本機站台就會反映核准的結果。');
}
