#!/usr/bin/env node
// 舊站匯出批次轉換（ARCHITECTURE 17.3）。
//
// 用法：
//   node scripts/import-legacy.mjs <export-dir> --out <dir> [--apply-migration] [--rules <file>] [--manifest <file>] [--slug <name>] [--now <ISO>] [--content <dir>]
//
//   <export-dir>        匯出目錄：每頁 {name}.html＋{name}.json 側檔（或一個 index.json 陣列），附件放 files/（格式見 docs/legacy-import.md）
//   --out <dir>         輸出：content/{dir}/{id}.json 草稿、content/assets/{id}/ 附件、report.json、report.md、migration-patch.json
//   --apply-migration   把 migration-patch.json 寫回 content/migration/{slug}.json（只改 status／target／note，不動 verified）
//   --rules <file>      規則檔（預設 content/migration/import/_import-rules.json）
//   --manifest <file>   移轉清單（預設 content/migration/{slug}.json；slug 預設為匯出目錄名）
//   --now <ISO>         轉換時間（預設現在；測試與可重現輸出用）
//   --content <dir>     以另一個 content/ 目錄當既有內容與主檔（預設 repo 的 content/；測試用）
//
// 清單只寫例外（extends 模板）時，標準子頁由 content/migration/_disease-template.json 依該疾病展開一起比對（推導項只進報告，不寫回清單）。
//
// 草稿不會寫進 content/：輸出目錄只供人工檢視；確認後由承辦人把草稿檔與 assets 搬進 content/ 開 PR。
import path from 'node:path';
import { runImport } from './lib/legacy-import/index.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--apply-migration') a.applyMigration = true;
    else if (['--out', '--rules', '--manifest', '--slug', '--now', '--content'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '-h' || t === '--help') a.help = true;
    else if (t.startsWith('--')) { console.error(`未知參數 ${t}`); process.exit(2); }
    else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args._[0] || !args.out) {
  console.log('用法：node scripts/import-legacy.mjs <export-dir> --out <dir> [--apply-migration] [--rules <file>] [--manifest <file>] [--slug <name>] [--now <ISO>] [--content <dir>]');
  process.exit(args.help ? 0 : 2);
}

try {
  const { report, patch } = runImport({
    exportDir: args._[0], outDir: args.out, rulesPath: args.rules, manifestPath: args.manifest, slug: args.slug, contentDir: args.content ? path.resolve(args.content) : undefined,
    applyMigration: !!args.applyMigration, now: args.now,
  });
  const s = report.summary;
  console.log(`批次 ${report.batch}：${s.pages} 頁 → ${s.drafts} 份草稿（${Object.entries(s.byType).map(([k, v]) => `${k} ${v}`).join('、')}）`);
  console.log(`平均信心 ${s.avgConfidence}；需人工檢視 ${s.needsReview}；既有內容已存在 ${s.existing}；附件與圖片 ${s.assets.total}（待補 alt ${s.assets.needsAlt}、PDF 無文字層 ${s.assets.noTextLayer}）`);
  console.log(`草稿 schema 驗證 ${s.drafts - s.schemaInvalid}/${s.drafts} 通過；問題 錯誤 ${s.issues.error}／警告 ${s.issues.warn}／提示 ${s.issues.info}`);
  if (report.manifest) {
    const ps = patch.summary;
    console.log(`移轉清單 ${report.manifest.id}：對上 ${ps.matched}/${ps.items}；建議 status 變化 ${ps.statusChanges}（pending→migrated ${ps.pendingToMigrated}）、note 更新 ${ps.noteChanges}、仍待移轉 ${ps.stillPending}、與清單判定不同 ${ps.conflicts}${ps.derivedItems ? `；模板推導 ${ps.derivedItems} 項對上 ${ps.derivedMatched}` : ''}${ps.unmatchedPages ? `；清單沒有的舊頁 ${ps.unmatchedPages}` : ''}`);
    if (report.migration.applied) console.log(`  已套用 --apply-migration：status ${report.migration.statusChanges.length} 筆、target ${report.migration.targetChanges.length} 筆、newPath ${report.migration.newPathChanges?.length ?? 0} 筆、note ${report.migration.noteChanges} 筆（verified 未動）→ ${report.migration.file}`);
    else console.log('  （未套用：加 --apply-migration 才會寫回移轉清單）');
  }
  console.log(`報告：${path.join(path.resolve(args.out), 'report.md')}`);
  if (s.schemaInvalid) { console.error(`有 ${s.schemaInvalid} 份草稿未通過 schema 驗證，見 report.json`); process.exitCode = 1; }
} catch (e) {
  console.error(`匯入失敗：${e.message}`);
  process.exit(1);
}
