// 智慧問答查詢紀錄報表（第四十一輪；說明見 docs/ask-log.md、同仁手冊第 42 節）。
//
// 用法：npm run ask-log:report [-- --min=3 --from=2026-10-01 --to=2026-10-31 --dir=.local/ask-log --out=.local/ask-log/report.json --rows=20]
//   --min   k-匿名門檻（問句在幾個不同日子出現、或被問幾次以上才列出文字；預設 3）
//   --dir   紀錄目錄（預設 .local/ask-log；正式環境把收件系統匯出的 NDJSON 日檔放到這裡即可）
//   --out   報表 JSON 輸出位置（預設 <dir>/report.json）。在 repo 裡只能寫在 .local/ 底下：報表含民眾問句，不能進版控
//
// 報表 JSON 可在後台 /admin/ask-log/ 用「載入 report.json」開啟；開發伺服器（npm run dev）則後台會直接讀 /api/dev/ask-log/report。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/load.mjs';
import { DEFAULT_DIR, DEFAULT_MIN, formatReport, reportFromDir } from './lib/ask-log-report.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=') || '1'];
    }),
);
const dir = path.resolve(args.dir ?? DEFAULT_DIR);
const out = path.resolve(args.out ?? path.join(dir, 'report.json'));
const inside = (p, base) => !path.relative(base, p).startsWith('..') && !path.isAbsolute(path.relative(base, p));
if (inside(out, ROOT) && !inside(out, path.join(ROOT, '.local'))) {
  console.error(`✗ 報表含民眾問句，只能寫在 .local/ 底下（或 repo 以外的位置）：${path.relative(ROOT, out)}`);
  process.exit(1);
}

const report = reportFromDir(dir, { minCount: Number(args.min) || DEFAULT_MIN, from: args.from ?? '', to: args.to ?? '' });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(formatReport(report, { rows: Number(args.rows) || 20 }));
console.log(
  `\n報表 JSON → ${inside(out, ROOT) ? path.relative(ROOT, out) : out}${report.totals.events ? '' : `\n（${path.relative(ROOT, dir) || dir} 沒有紀錄：先 npm run dev，到 /ask/ 問幾題）`}`,
);
