#!/usr/bin/env node
// 第六十三輪（Issue #141）：部署產物稽核 CLI。資訊室對「實際要部署（或已部署）的目錄」執行，CD 管線在正式建置後執行。
//
// 用法：node scripts/audit-dist.mjs [目錄，預設 dist] [--profile public|prototype（預設 public）] [--json]
//       npm run audit:dist -- dist --profile public
// 結束碼：0＝沒有不得公開的檔案；1＝有（逐一列出路徑、命中的規則、理由）；2＝參數或目錄錯誤。
// 為什麼要另外一支：建置內的檢查保護的是「這次建置」；部署時可能有人手動補檔、從舊版複製、或 CDN 同步多帶東西，
// 所以檢查要能對最後那一包再跑一次（規則與 build.mjs 同一份：scripts/lib/dist-profile.mjs）。
import path from 'node:path';
import fs from 'node:fs';
import { auditDist } from './lib/dist-profile.mjs';

const argv = process.argv.slice(2);
let dir = 'dist',
  profile = 'public',
  json = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') json = true;
  else if (a === '--profile') profile = argv[++i];
  else if (a.startsWith('--profile=')) profile = a.slice('--profile='.length);
  else if (a === '-h' || a === '--help') {
    console.log('用法：node scripts/audit-dist.mjs [目錄] [--profile public|prototype] [--json]');
    process.exit(0);
  } else dir = a;
}
if (profile !== 'public' && profile !== 'prototype') {
  console.error(`--profile 只能是 public 或 prototype（現在是 ${profile}）`);
  process.exit(2);
}
const root = path.resolve(dir);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`找不到目錄：${root}`);
  process.exit(2);
}
const r = auditDist(root, { profile: /** @type {'public'|'prototype'} */ (profile) });
if (json) {
  console.log(JSON.stringify({ ok: r.ok, profile: r.profile, files: r.files, forbidden: r.forbidden, expected: r.expected, inventory: r.inventory }, null, 2));
} else {
  console.log(`部署產物稽核：${root}（profile ${profile}，${r.files} 檔）`);
  if (r.expected.length) {
    console.log('\n原型限定（profile prototype 允許，正式站不得出現）：');
    for (const e of r.expected) console.log(`  ${String(e.count).padStart(6)}  ${e.rule.padEnd(24)} ${e.reason}`);
  }
  if (r.forbidden.length) {
    const byRule = new Map();
    for (const f of r.forbidden) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
    console.log(`\n✗ 不得公開的檔案 ${r.forbidden.length} 個：`);
    console.log('  數量    規則                     理由／前幾個路徑');
    for (const [rule, list] of byRule) {
      console.log(`  ${String(list.length).padStart(6)}  ${rule.padEnd(24)} ${list[0].reason}`);
      for (const f of list.slice(0, 5)) console.log(`          - ${f.path}`);
      if (list.length > 5) console.log(`          …另 ${list.length - 5} 個`);
    }
  } else console.log('\n✓ 沒有不得公開的檔案');
  const inv = r.inventory;
  console.log(
    `\n清冊摘要：HTML ${inv.counts.html} 頁、v1 JSON ${inv.api.v1JsonCount} 個、後台頁 ${inv.adminPages.length} 頁、外部來源 ${inv.externalOrigins.length} 個（${inv.externalOrigins.map((o) => o.origin).join('、')}）`,
  );
  console.log('完整清冊：加 --json；建置時另寫在 dist/headers/exposure.json（原型）或 dist-internal/exposure.json（正式）。');
}
process.exit(r.ok ? 0 : 1);
