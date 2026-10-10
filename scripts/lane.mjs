#!/usr/bin/env node
// 發布車道判定（ARCHITECTURE 17.1）：由變更檔案推出車道與審核需求，輸出 JSON 給 CI（.github/workflows/content-pr.yml）。
// 用法：
//   node scripts/lane.mjs content/news/x.json content/diseases/dengue.json
//   git diff --name-only origin/main...HEAD | node scripts/lane.mjs
//   node scripts/lane.mjs --since=2026-10-04T01:00:00Z --files-from=changed.txt
// 參數：--since=ISO（SLA 起算時間，預設現在；CI 傳 PR 建立時間）、--files-from=檔案（一行一個路徑）、--root=目錄（預設 repo 根目錄）
//       --author=GitHub 帳號（PR 作者；第二十三輪：自動合併車道要在 lanes.json allowedAuthors 內，否則降為一般車道）、--teams=org/slug,org/slug（作者所屬 team，CI 查好傳入）
// 輸出：{ lane, label, ghLabel, autoMerge, requiredApprovals, reviewers, reviewerAccounts, sla, postPublishReview, files:[{file,type,lane,reason}], reasons:[] }
// 多檔取最嚴格（standard ＞ fast ＞ emergency）；content/ 以外（scripts、src、docs…）一律一般車道並註明「程式／文件變更需審核」。
import fs from 'node:fs';
import path from 'node:path';
import { laneForFiles, loadLanes, validateLanes } from './lib/lanes.mjs';
import { ROOT } from './lib/load.mjs';
import { config } from '../site.config.mjs';

const opts = {};
const files = [];
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) opts[m[1]] = m[2] ?? true; else files.push(a);
}
if (opts.help) {
  console.log('用法：node scripts/lane.mjs [--since=ISO] [--author=帳號] [--teams=org/slug,…] [--files-from=檔案] [--root=目錄] <變更檔案…>（無參數時讀 stdin）');
  process.exit(0);
}
const splitLines = (s) => String(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
if (typeof opts['files-from'] === 'string') files.push(...splitLines(fs.readFileSync(opts['files-from'], 'utf8')));
if (!files.length && !opts['files-from'] && !process.stdin.isTTY) {
  try { files.push(...splitLines(fs.readFileSync(0, 'utf8'))); } catch { /* 沒有 stdin */ }
}

const cfg = loadLanes();
const errs = validateLanes(cfg);
if (errs.length) {
  console.error(`lanes.json 有誤：\n- ${errs.join('\n- ')}`);
  process.exit(2);
}
const root = typeof opts.root === 'string' ? path.resolve(opts.root) : ROOT;
const since = typeof opts.since === 'string' && opts.since ? opts.since : Date.now();
const author = typeof opts.author === 'string' ? opts.author : null;
const teams = typeof opts.teams === 'string' ? opts.teams.split(',').map((x) => x.trim()).filter(Boolean) : [];
const out = laneForFiles(files, { root, cfg, since, tier1Types: config.tier1Types, author, teams });
console.log(JSON.stringify(out, null, 2));
