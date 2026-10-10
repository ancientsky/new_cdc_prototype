#!/usr/bin/env node
// 第三十輪（#55）：個資掃描（命令列）。規則與白名單見 scripts/lib/pii-scan.mjs、content/governance/pii-allowlist.json。
// 用法：
//   node scripts/pii-scan.mjs                         掃全部範圍（content/、data/snapshots/）
//   node scripts/pii-scan.mjs content/jobs/a.json …  只掃指定檔或目錄（CI 傳 PR 改到的檔；範圍外、已刪除的檔自動略過）
//   node scripts/pii-scan.mjs --all docs/             不限範圍（手動檢查用；docs、tests 裡的範例號碼會被報出來是正常的）
// 有命中 ⇒ exit 1。輸出只有檔名、位置、類別與遮罩後的片段，不印出完整號碼或姓名（CI 紀錄是公開的）。
// 在 GitHub Actions 裡另外輸出 ::error 註記，PR 的 Files changed 頁面會直接標在那個檔上。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPaths, formatHit, ALLOWLIST_PATH, SCAN_ROOTS } from './lib/pii-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const all = argv.includes('--all');
const paths = argv.filter((a) => !a.startsWith('--'));
const r = scanPaths(ROOT, paths.length ? paths : SCAN_ROOTS, { all });
const gha = process.env.GITHUB_ACTIONS === 'true';
// ::error 的訊息不能有換行與 %（GitHub 指令格式）
const ghaEsc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

for (const e of r.allowlistErrors) {
  console.error(`❌ [個資掃描] ${e}`);
  if (gha) console.log(`::error file=${ALLOWLIST_PATH},title=個資掃描白名單::${ghaEsc(e)}`);
}
for (const h of r.hits) {
  console.error(`❌ [個資掃描] ${formatHit(h)}`);
  if (gha) console.log(`::error file=${h.file},title=個資掃描：${h.label}::${ghaEsc(`${h.where}：${h.masked}（片段：${h.excerpt}）`)}`);
}
const bad = r.hits.length + r.allowlistErrors.length;
if (bad) {
  console.error(`\n個資掃描未通過：${r.hits.length} 處疑似個資（掃描 ${r.files} 個檔）。`);
  console.error('處理方式：個資請直接刪除（並請管理者評估是否要清 Git 歷史）；若確定不是個資（例如機關公開電話、刻意的測試樣本），');
  console.error(`加進 ${ALLOWLIST_PATH} 並寫明 reason，審核人會看。說明見 docs/guide-staff.md 第 33 節。`);
  process.exit(1);
}
console.log(`✅ 個資掃描通過：${r.files} 個檔${r.skipped.length ? `（略過不存在的 ${r.skipped.length} 個路徑）` : ''}${r.files === 0 ? '（沒有在掃描範圍內的檔案）' : ''}`);
