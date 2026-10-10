#!/usr/bin/env node
// 建置總管：load → validate → govern → index → render → emit
// 用法：node scripts/build.mjs [--check] [--today=YYYY-MM-DD] [--fix-assets]
//   --fix-assets：先把 content/assets/{id}/ 實際檔案的 bytes／sha256／mime／width／height 補寫回內容 JSON（只改 assets 欄位），再照常驗證與建置
//                 （npm run build -- --fix-assets；只想補寫不輸出：node scripts/build.mjs --check --fix-assets）
// 第九輪（ARCHITECTURE 17.1／17.2）：
//   - 排程發布：publishAt 以真實現在時間判斷（BUILD_NOW=ISO 可覆寫，測試／重現用；BUILD_TODAY 只影響治理日期）。
//     排程中內容不渲染、不進答案索引、sitemap、API、RSS、llms.txt，也不複製其檔案資產（一律經 scripts/lib/lanes.mjs 的 publicView／isPublic）。
//     PREVIEW_SCHEDULED=1（只給 PR 預覽用）：「現在」推到最晚 publishAt 之後，預覽裡看得到排程中內容。
//   - PR 預覽：PREVIEWS_DIR（pages.yml 把 previews 分支取出到這裡）存在 ⇒ 連結檢查之後整包複製到 dist/preview/（pr-{N}/…）；
//     不存在就略過。預覽站各自以自己的 BASE_PATH 建置，不納入主站連結檢查。
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../site.config.mjs';
import { loadSite, ROOT } from './lib/load.mjs';
import { validateSite, contentWarnings } from './lib/validate.mjs';
import { applyGovernance } from './lib/governance.mjs';
import { buildSearchIndex } from './lib/index-builder.mjs';
import { applyConsistency } from './lib/consistency.mjs';
import { emitApi } from './lib/emit-api.mjs';
import { emitSeo } from './lib/emit-seo.mjs';
import { emitHeaders } from './lib/emit-headers.mjs';
import { renderAllPages } from './lib/pages.mjs';
import { emitI18nBundles } from './lib/i18n-split.mjs';
import { checkJsBudget } from './lib/js-budget.mjs';
import { buildPagefindIndex } from './lib/pagefind.mjs';
import { runEval } from '../eval/run-eval.mjs';
import { todayISO } from './lib/render.mjs';
import { checkInternalLinks, summarize as summarizeLinks } from './lib/check-internal-links.mjs';
import { validateAssets, fixAssets, copyAssets, normalizeFileLinks } from './lib/assets.mjs';
import { publicView, scheduledItems, taipeiTime, publishAtMs } from './lib/lanes.mjs';
import { piiErrors } from './lib/pii-scan.mjs';
import { formErrors } from './lib/forms.mjs';

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
  // 排程發布的「現在」：整個建置用同一個時間點（治理、頁面、API、SEO 一致）
  site.now = process.env.BUILD_NOW ? new Date(process.env.BUILD_NOW).getTime() : Date.now();
  if (!Number.isFinite(site.now)) { console.error(`❌ BUILD_NOW 不是有效時間：${process.env.BUILD_NOW}`); process.exit(1); }
  // PR 預覽（content-pr.yml 設 PREVIEW_SCHEDULED=1）：把「現在」推到最晚的 publishAt 之後，讓審核人在預覽裡看得到排程中內容
  if (process.env.PREVIEW_SCHEDULED === '1') {
    const latest = Math.max(0, ...site.all.map((i) => publishAtMs(i.publishAt) ?? 0));
    if (latest >= site.now) { site.now = latest + 1000; log(`PREVIEW_SCHEDULED：now 推到 ${new Date(site.now).toISOString()}，預覽顯示排程中內容`); }
  }
  log(`載入 ${site.all.length} 筆內容、${site.master.diseases.length} 種傳染病主檔`);

  if (args['fix-assets']) {
    const fixed = fixAssets(site);
    log(`--fix-assets：補寫 ${fixed.changed.length} 個檔的欄位、改寫 ${fixed.written.length} 個內容檔${fixed.written.length ? `（${fixed.written.join('、')}）` : ''}`);
  }
  const assetReport = validateAssets(site, config);
  for (const w of assetReport.warnings) console.warn('  ⚠ [assets]', w);
  for (const w of contentWarnings(site)) console.warn('  ⚠ [內容]', w);
  // 第三十輪（#55）：個資掃描（content/、data/snapshots/、會複製到 dist 的內容附件）。命中就是治理門檻錯誤，--check 與正式建置都會失敗；表單端點設定矛盾（post 沒端點等）也一樣
  const errors = [...validateSite(site), ...assetReport.errors.map((e) => `[assets] ${e}`), ...piiErrors(ROOT), ...formErrors(config)];
  if (errors.length) {
    console.error(`\n❌ 治理門檻未通過（${errors.length} 項）：`);
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }
  log(`schema 與參照檢查通過；檔案資產 ${assetReport.files} 個（${assetReport.items} 筆內容、${(assetReport.bytes / 1024).toFixed(0)} KB${assetReport.orphans.length ? `、孤兒檔 ${assetReport.orphans.length}` : ''}）`);

  applyGovernance(site);
  log(`治理：白名單 ${site.gov.whitelistCount}/${site.gov.totalPublished}、待辦 ${site.gov.todos.length}、AI ${site.gov.pausedAI ? '暫停' : '運作'}`);
  const scheduled = scheduledItems(site);
  log(`排程發布：now=${new Date(site.now).toISOString()}；排程中 ${scheduled.length} 筆${scheduled.length ? `（${scheduled.map((i) => `${i.id}＠${taipeiTime(publishAtMs(i.publishAt))}`).join('、')}）` : ''}，不輸出`);

  // 答案索引只收已上線內容（排程中不進索引）
  site.searchIndex = buildSearchIndex(publicView(site));
  // 第三十三輪：跨內容說法一致性（ARCHITECTURE §39）。在答案索引上比對，候選寫成待辦並標在答案單元上；已判定的錯句移出索引
  applyConsistency(site);
  log(`說法一致性：比對 ${site.gov.consistency.sentencesCompared} 句，待判定 ${site.gov.consistency.candidates} 組、已判定待修正 ${site.gov.consistency.confirmed} 組、判定非矛盾 ${site.gov.consistency.dismissed} 組`);
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
  // 介面字串依語言拆檔（issue #34）：i18n.<lang>.js 取代完整 i18n.js
  const i18nSizes = emitI18nBundles(DIST);
  log(`i18n 拆檔 → assets/js/i18n.<lang>.js：${Object.entries(i18nSizes).map(([l, b]) => `${l} ${(b / 1024).toFixed(0)}KB`).join('、')}`);
  if (fs.existsSync(path.join(ROOT, 'src/public'))) copyDir(path.join(ROOT, 'src/public'), DIST);
  // 檔案資產：只複製 published／archived 內容有宣告的檔 → dist/files/{id}/{file}
  const copied = copyAssets(publicView(site), DIST);
  log(`檔案資產 → dist/files/：${copied.files} 個檔（${copied.items} 筆內容、${(copied.bytes / 1024).toFixed(0)} KB）`);
  writeOut('.nojekyll', '');
  // 第二十三輪（26.2）：掃 dist 的 inline script 算雜湊 → 安全標頭設定檔（dist/headers/）。超過 40 段代表有模板把每頁資料塞進 inline script，要改成 data 屬性或 application/json。
  const hdr = emitHeaders(DIST, writeOut);
  log(`安全標頭 → dist/headers/（inline script 雜湊 ${hdr.info.count} 段）${hdr.info.count > 40 ? '  ⚠ inline script 過多，請檢查' : ''}`);

  // 每頁 JS 預算（issue #34）：公開頁超過預算 ⇒ 建置失敗。調整方式見 scripts/lib/js-budget.mjs（JS_BUDGET_KB）
  const jsb = checkJsBudget(DIST, { basePath: config.basePath });
  log(`JS 預算：公開頁最大 ${(jsb.public.max / 1024).toFixed(1)} KB（${jsb.public.maxPage}，預算 ${jsb.public.budgetKb} KB，${jsb.public.count} 頁）；含答案引擎的頁最大 ${(jsb.engine.max / 1024).toFixed(1)} KB（${jsb.engine.maxPage}，預算 ${jsb.engine.budgetKb} KB，${jsb.engine.count} 頁）；後台頁最大 ${(jsb.admin.max / 1024).toFixed(1)} KB（${jsb.admin.maxPage}）`);
  if (!jsb.ok) {
    console.error(`❌ 有頁面的 JS 超過預算：${[...jsb.public.over, ...jsb.admin.over].slice(0, 10).map((r) => `${r.page} ${(r.bytes / 1024).toFixed(1)}KB`).join('；')}`);
    process.exit(1);
  }  log(`輸出 ${pageCount} 頁 → dist/（${Date.now() - t0} ms）`);

  // 第二十八輪（ARCHITECTURE 31）：Pagefind 全文索引 → dist/pagefind/。必須在複製 PR 預覽之前（預覽各自有自己的索引，不能混進主站）
  const pfi = await buildPagefindIndex(DIST, { log });
  if (!pfi.skipped) log(`全文索引 → dist/pagefind/：${pfi.pages} 頁、語言 ${pfi.languages.join('／')}、${pfi.files} 檔 ${(pfi.bytes / 1024 / 1024).toFixed(1)} MB（執行期 ${(pfi.runtime / 1024).toFixed(0)} KB，第一次搜尋才載入）、${pfi.ms} ms`);

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

  // PR 預覽（17.2）：連結檢查之後才複製，預覽站不影響主站閘門
  const previews = process.env.PREVIEWS_DIR ? path.resolve(process.env.PREVIEWS_DIR) : null;
  if (previews && fs.existsSync(previews)) {
    const dirs = fs.readdirSync(previews, { withFileTypes: true }).filter((e) => e.isDirectory() && /^pr-\d+$/.test(e.name)).map((e) => e.name);
    for (const d of dirs) copyDir(path.join(previews, d), path.join(DIST, 'preview', d));
    log(`PR 預覽 → dist/preview/：${dirs.length} 個（${dirs.join('、') || '無'}）`);
  } else if (previews) log(`PREVIEWS_DIR=${previews} 不存在，略過 PR 預覽`);
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
