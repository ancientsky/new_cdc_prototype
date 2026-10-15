#!/usr/bin/env node
// 第五十四輪：可以要求所有存檔都帶版本碼了嗎？讀寫入閘道的稽核紀錄，回答「最近兩週有沒有人存檔沒帶版本碼」（docs/deploy.md §26.3）。
// 用法：
//   npm run gateway:basehash                     讀 .local/gateway-audit.jsonl（或 GATEWAY_AUDIT_FILE），以今天（台灣日期）往回 14 天
//   node scripts/gateway-basehash.mjs --days=14 --min-writes=20 --today=2026-10-29 --file=稽核紀錄.jsonl --json
// 結束碼：0 ＝ 可以打開；1 ＝ 還不行（理由會印出來）；2 ＝ 讀不到稽核紀錄。可以放進排程，每週寄給資訊室與 OASIS。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/load.mjs';
import { baseHashReadiness, readinessText, taipeiDay } from './lib/gateway/basehash-report.mjs';

const opts = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.match(/^--([^=]+)(?:=(.*))?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2] ?? true]),
);
const file = path.resolve(ROOT, typeof opts.file === 'string' ? opts.file : process.env.GATEWAY_AUDIT_FILE || '.local/gateway-audit.jsonl');
if (!fs.existsSync(file)) {
  console.error(`找不到稽核紀錄：${file}（閘道還沒啟動過，或請用 --file= 指定）`);
  process.exit(2);
}
const entries = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const today = typeof opts.today === 'string' ? opts.today : taipeiDay(new Date().toISOString());
const r = baseHashReadiness(entries, { today, days: Number(opts.days ?? 14), minWrites: Number(opts['min-writes'] ?? 1) });
console.log(opts.json ? JSON.stringify(r, null, 2) : readinessText(r));
process.exit(r.ready ? 0 : 1);
