#!/usr/bin/env node
// 建置總管：load → validate → govern → index → render → emit
// 用法：node scripts/build.mjs [--check] [--today=YYYY-MM-DD] [--fix-assets]
//   --fix-assets：先把 content/assets/{id}/ 實際檔案的 bytes／sha256／mime／width／height 補寫回內容 JSON（只改 assets 欄位），再照常驗證與建置
//                 （npm run build -- --fix-assets；只想補寫不輸出：node scripts/build.mjs --check --fix-assets）
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
import { checkInternalLinks, summarize as summarizeLinks } from './lib/check-internal-links.mjs';
import { validateAssets, fixAssets, copyAssets, normalizeFileLinks } from './lib/assets.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const t0 = Date.now();
const log = (...m) => console.log('[build]', ...m);

export function writeOut(rel, content) {
  const p = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 第八輪（16.1）：/files/ 網址七語共用 ⇒ HTML 內的檔案連結統一為 basePath + /files/…（去掉 ctx.url() 加的語言前綴、補 basePath）
  fs.writeFileSync(p, rel.endsWith('.html') ? normalizeFileLinks(content, { basePath: config.basePath, langs: config.langs, siteUrl: config.siteUrl }) : content);
}

async function main() {
  const today = typeof args.today === 'string' ? args.today : (process.env.BUILD_TODAY || todayISO());
  log(`today=${today} basePath=${config.basePath || '/'}`);
  const site = loadSite(config);
  site.today = today;
  log(`載入 ${site.all.length} 筆內容、${site.master.diseases.length} 種傳染病主檔`);

  if (args['fix-assets']) {
    const fixed = fixAssets(site);
    log(`--fix-assets：補寫 ${fixed.changed.length} 個檔的欄位、改寫 ${fixed.written.length} 個內容檔${fixed.written.length ? `（${fixed.written.join('、')}）` : ''}`);
  }
  const assetReport = validateAssets(site, config);
  for (const w of assetReport.warnings) console.warn('  ⚠ [assets]', w);
  const errors = [...validateSite(site), ...assetReport.errors.map((e) => `[assets] ${e}`)];
  if (errors.length) {
    console.error(`\n❌ 治理門檻未通過（${errors.length} 項）：`);
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }
  log(`schema 與參照檢查通過；檔案資產 ${assetReport.files} 個（${assetReport.items} 筆內容、${(assetReport.bytes / 1024).toFixed(0)} KB${assetReport.orphans.length ? `、孤兒檔 ${assetReport.orphans.length}` : ''}）`);

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
  const pageCount = await renderAllPages(site, writeOut);
  // 靜態資源
  copyDir(path.join(ROOT, 'src/styles'), path.join(DIST, 'assets/styles'));
  copyDir(path.join(ROOT, 'src/client'), path.join(DIST, 'assets/js'));
  if (fs.existsSync(path.join(ROOT, 'src/public'))) copyDir(path.join(ROOT, 'src/public'), DIST);
  // 檔案資產：只複製 published／archived 內容有宣告的檔 → dist/files/{id}/{file}
  const copied = copyAssets(site, DIST);
  log(`檔案資產 → dist/files/：${copied.files} 個檔（${copied.items} 筆內容、${(copied.bytes / 1024).toFixed(0)} KB）`);
  writeOut('.nojekyll', '');
  log(`輸出 ${pageCount} 頁 → dist/（${Date.now() - t0} ms）`);

  // 全站連結完整性（站內連結必須指到存在的檔案；外部連結收集清單；佔位／示意網址 = error）
  // --check 或 CI 下有 error ⇒ exit 1；LINK_CHECK=warn 可暫時降為警告（整合期用），LINK_CHECK=off 略過。
  if (process.env.LINK_CHECK !== 'off') {
    const links = checkInternalLinks(DIST, { basePath: config.basePath, langs: config.langs, siteUrl: config.siteUrl });
    summarizeLinks(links, { limit: 50, log: (m) => console.log(m) });
    log('連結報告 → v1/governance/link-report.json、external-links.json');
    if (!links.ok) {
      const strict = (args.check || process.env.CI) && process.env.LINK_CHECK !== 'warn';
      console.error(`${strict ? '❌' : '⚠'} 站內連結檢查：${links.counts.errors} 個壞連結（${links.errorsByTarget.length} 種目標）${strict ? '，依治理門檻不得上線' : '（非 --check／CI，僅警告）'}`);
      if (strict) process.exit(1);
    }
  }
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
