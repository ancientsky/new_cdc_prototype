#!/usr/bin/env node
// 傳染病核心教材「重建版」來源檔 → 文件 JSON（第二十八輪；docs/pdf-ingest.md 第 9 節、guide-staff §31）。
//
//   node scripts/curriculum-to-doc.mjs data/curriculum/<slug>.source.json --out content/documents/<id>.json
//
// 只在「沒有 PDF 正本」時用。有 PDF 正本時請改用 scripts/pdf-to-md.mjs（真的轉檔、每頁頁碼可引用）。
// 產出的 derivedFrom.reviewStatus 一律是 machine：不進 AI 白名單、專業版來源卡標「未查證，以 PDF 正本為準」、開連動待辦。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildCurriculumDoc, curriculumStats } from './lib/curriculum.mjs';

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith('--'));
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : null;
if (!input) {
  console.error('用法：node scripts/curriculum-to-doc.mjs data/curriculum/<slug>.source.json [--out content/documents/<id>.json]');
  process.exit(2);
}
const buf = fs.readFileSync(input);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const doc = buildCurriculumDoc(JSON.parse(buf.toString('utf8')), { file: path.basename(input), sha256 });
if (out) fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(JSON.stringify({ id: doc.id, sha256, ...curriculumStats(doc) }, null, 2));
if (!out) process.stdout.write(doc.machineReadableMarkdown);
