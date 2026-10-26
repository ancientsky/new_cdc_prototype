#!/usr/bin/env node
// 第六十六輪：單位改組時整批改內容的權責單位（owner）。說明見 scripts/lib/reassign-owner.mjs、docs/guide-staff.md §61、docs/deploy.md §33。
// 用法：
//   npm run reassign-owner -- --from unit.a --to unit.b [--type disease,faq] [--dry-run] [--report 路徑]
//   --dry-run   只列出會改哪些，不寫檔（先跑這個，把報告貼給單位確認）
//   --type      只改這些型別（逗號分隔）；不填＝全部（含疾病主檔、移轉清單等）
//   --report    Markdown 報告寫到哪裡；不填＝.local/reassign-owner/<日期>-<from>-to-<to>.md（不進版控）
// 改完開 PR：動到內容檔，走一般車道，由 OASIS 與公關室審核。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reassignOwner, formatTable, formatReport, ReassignError } from './lib/reassign-owner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};
const root = path.resolve(opt('root') ?? ROOT);
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
try {
  const r = reassignOwner({
    root,
    from: opt('from') ?? '',
    to: opt('to') ?? '',
    types:
      opt('type')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? null,
    dryRun: argv.includes('--dry-run'),
  });
  console.log(formatTable(r));
  const out = path.resolve(root, opt('report') ?? `.local/reassign-owner/${today}-${r.from.id}-to-${r.to.id}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, formatReport(r, { today }));
  console.log(`\n報告：${path.relative(process.cwd(), out) || out}`);
  if (!r.dryRun && r.files.length)
    console.log('下一步：npm run build 確認通過，再開 PR（一般車道，OASIS 與公關室審核）；舊單位在 units.json 加 retiredAt 與 successor。');
} catch (e) {
  if (e instanceof ReassignError) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  throw e;
}
