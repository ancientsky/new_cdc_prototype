#!/usr/bin/env node
// 建置總管：load → validate → govern → index → render → emit
// 用法：node scripts/build.mjs [--check] [--today=YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { loadSite, ROOT } from './lib/load.mjs';
import { validateSite } from './lib/validate.mjs';
import { applyGovernance } from './lib/governance.mjs';
import { buildSearchIndex } from './lib/index-builder.mjs';
import { emitApi } from './lib/emit-api.mjs';
import { emitSeo } from './lib/emit-seo.mjs';
import { renderAllPages } from './lib/pages.mjs';
import { runEval } from '../eval/run-eval.mjs';
import { todayISO } from './lib/render.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const DIST = path.join(ROOT, 'dist');
const t0 = Date.now();
const log = (...m) => console.log('[build]', ...m);

export function writeOut(rel, content) {
  const p = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

async function main() {
  const today = typeof args.today === 'string' ? args.today : (process.env.BUILD_TODAY || todayISO());
  log(`today=${today} basePath=${config.basePath || '/'}`);
  const site = loadSite(config);
  site.today = today;
  log(`載入 ${site.all.length} 筆內容、${site.master.diseases.length} 種傳染病主檔`);

  const errors = validateSite(site);
  if (errors.length) {
    console.error(`\n❌ 治理門檻未通過（${errors.length} 項）：`);
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }
  log('schema 與參照檢查通過');

  applyGovernance(site);
  log(`治理：白名單 ${site.gov.whitelistCount}/${site.gov.totalPublished}、待辦 ${site.gov.todos.length}、AI ${site.gov.pausedAI ? '暫停' : '運作'}`);

  site.searchIndex = buildSearchIndex(site);
  log(`答案單元：民眾 ${site.searchIndex.public.length}、專業 ${site.searchIndex.pro.length}`);

  const evalReport = await runEval(site);
  site.evalReport = evalReport;
  log(`評估集 ${evalReport.total} 題：通過 ${evalReport.passed}，版本題 ${evalReport.byCategory.version?.passed ?? 0}/${evalReport.byCategory.version?.total ?? 0}`);
  if (evalReport.byCategory.version && evalReport.byCategory.version.passed !== evalReport.byCategory.version.total) {
    console.error('❌ 版本題未全對，依規格不得上線。失敗題：');
    for (const f of evalReport.failures.filter((x) => x.category === 'version')) console.error('  -', f.id, f.q, '→', f.reasons.join('; '));
    if (args.check || process.env.CI) process.exit(1);
  }
  if (args.check && !args.emit) { log('check 完成'); return; }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  emitApi(site, writeOut);
  emitSeo(site, writeOut);
  const pageCount = renderAllPages(site, writeOut);
  // 靜態資源
  copyDir(path.join(ROOT, 'src/styles'), path.join(DIST, 'assets/styles'));
  copyDir(path.join(ROOT, 'src/client'), path.join(DIST, 'assets/js'));
  if (fs.existsSync(path.join(ROOT, 'src/public'))) copyDir(path.join(ROOT, 'src/public'), DIST);
  writeOut('.nojekyll', '');
  log(`輸出 ${pageCount} 頁 → dist/（${Date.now() - t0} ms）`);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
