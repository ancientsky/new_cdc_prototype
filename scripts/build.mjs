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
import { validateSite, contentWarnings, pendingReviewWarnings } from './lib/validate.mjs';
import { applyGovernance, overdueAsOf } from './lib/governance.mjs';
import { buildSearchIndex } from './lib/index-builder.mjs';
import { applyConsistency } from './lib/consistency.mjs';
import { emitApi } from './lib/emit-api.mjs';
import { emitSeo } from './lib/emit-seo.mjs';
import { emitHeaders } from './lib/emit-headers.mjs';
import { renderAllPages } from './lib/pages.mjs';
import { emitI18nBundles, emitRefusalBundles } from './lib/i18n-split.mjs';
import { checkJsBudget, checkAskDataBudget } from './lib/js-budget.mjs';
import { minifyDir } from './lib/minify.mjs';
import { buildPagefindIndex, verifyPagefindRecall } from './lib/pagefind.mjs';
import { runEval } from '../eval/run-eval.mjs';
import { todayISO } from './lib/render.mjs';
import { checkInternalLinks, summarize as summarizeLinks } from './lib/check-internal-links.mjs';
import { validateAssets, fixAssets, copyAssets, normalizeFileLinks } from './lib/assets.mjs';
import { publicView, scheduledItems, taipeiTime, taipeiDate, publishAtMs, personalAccountWarnings } from './lib/lanes.mjs';
import { piiErrors } from './lib/pii-scan.mjs';
import { checkI18nQuality, summarizeI18nQuality } from './lib/i18n-quality.mjs';
import { formErrors, askLogErrors } from './lib/forms.mjs';
import { themeCss, themeCssPath } from './lib/theme.mjs';
import { auditDist, splitForProduction, adminOriginErrors } from './lib/dist-profile.mjs';
import { emitInteractives } from './lib/interactives.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
// 第六十三輪（Issue #141）：正式建置（SITE_MODE=production）把後台、source map、標頭設定檔搬到這裡（預設與 dist 同層的 dist-internal/）
const DIST_INTERNAL = process.env.DIST_INTERNAL_DIR ? path.resolve(process.env.DIST_INTERNAL_DIR) : path.join(path.dirname(DIST), 'dist-internal');
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
  for (const w of pendingReviewWarnings(site)) console.warn('  ⚠ [待確認]', w); // 第四十八輪（issue #93）：只警告
  for (const w of personalAccountWarnings()) console.warn('  ⚠ [發布名單]', w); // 第六十六輪：名單寫個人帳號，人員異動就過時；只警告
  // 第三十輪（#55）：個資掃描（content/、data/snapshots/、會複製到 dist 的內容附件）。命中就是治理門檻錯誤，--check 與正式建置都會失敗；表單端點設定矛盾（post 沒端點等）也一樣
  const errors = [...validateSite(site), ...assetReport.errors.map((e) => `[assets] ${e}`), ...piiErrors(ROOT), ...formErrors(config), ...askLogErrors(config), ...adminOriginErrors(config)];
  if (errors.length) {
    console.error(`\n❌ 治理門檻未通過（${errors.length} 項）：`);
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }
  log(`schema 與參照檢查通過；檔案資產 ${assetReport.files} 個（${assetReport.items} 筆內容、${(assetReport.bytes / 1024).toFixed(0)} KB${assetReport.orphans.length ? `、孤兒檔 ${assetReport.orphans.length}` : ''}）`);

  applyGovernance(site);
  log(`治理：白名單 ${site.gov.whitelistCount}/${site.gov.totalPublished}、待辦 ${site.gov.todos.length}、AI ${site.gov.pausedAI ? '暫停' : '運作'}`);
  // 第五十輪：BUILD_TODAY 比真實日期早（CI、GitHub Pages 凍結在 2026-10-01）時，列出「以今天算已逾審閱期限」但這次建置仍當作未逾期的內容。
  // 只警告、不擋建置：凍結日期是刻意的（示範案例要穩定），但不能讓「真的逾期了」被藏起來沒人知道（docs/deploy.md §21）。
  const realToday = taipeiDate(Date.now());
  const hiddenOverdue = overdueAsOf(site, realToday);
  if (hiddenOverdue.length) {
    const msg = `BUILD_TODAY=${today} 比今天（${realToday}）早：以今天計算另有 ${hiddenOverdue.length} 筆已逾審閱期限，這次建置仍當作未逾期${hiddenOverdue.some((h) => h.whitelisted) ? '、仍在 AI 白名單' : ''}：${hiddenOverdue.map((h) => `${h.id}（到期 ${h.nextReviewAt}）`).join('、')}。請權責單位重新審閱（guide-staff §51）`;
    console.warn('  ⚠ [審閱到期]', msg);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=審閱到期（BUILD_TODAY 早於今天）::${msg}`);
  }
  // 第六十輪（Issue #127）：節慶主題（套用哪一個、為什麼沒套用——疫情緊急、沒有生效中的主題）
  log(site.theme.message);
  // 第六十二輪：互動模組（哪些顯示、為什麼沒顯示——疫情緊急、都關著）
  log(site.interactives.message);
  if (site.interactives.reason === 'emergency' && process.env.GITHUB_ACTIONS) console.log(`::notice title=互動模組未顯示::${site.interactives.message}`);
  if (site.theme.reason === 'emergency' && process.env.GITHUB_ACTIONS) console.log(`::notice title=節慶主題未套用::${site.theme.message}`);
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
  // 第六十輪：只輸出「這次建置生效」的主題 CSS（layout 只在同一條件下連它）；下架或疫情緊急時檔案也不存在
  if (site.theme.active) writeOut(themeCssPath(site.theme.active).slice(1), themeCss(site.theme.active));
  // 第六十二輪：顯示中的「歷史上的今天」條目 → v1/interactives/<slug>.json（首頁小卡依瀏覽器日期換條目）
  emitInteractives(site, writeOut);
  // 介面字串依語言拆檔（issue #34）：i18n.<lang>.js 取代完整 i18n.js
  const i18nSizes = emitI18nBundles(DIST);
  log(`i18n 拆檔 → assets/js/i18n.<lang>.js：${Object.entries(i18nSizes).map(([l, b]) => `${l} ${(b / 1024).toFixed(0)}KB`).join('、')}`);
  // 第四十八輪：答案引擎拒答文案依語言拆檔（answer/refusal-i18n.<lang>.js），答案頁只載當頁語言
  const refusalSizes = emitRefusalBundles(DIST);
  log(`拒答文案拆檔 → assets/js/answer/refusal-i18n.<lang>.js：${Object.entries(refusalSizes).map(([l, b]) => `${l} ${(b / 1024).toFixed(1)}KB`).join('、')}`);
  // 第三十四輪（ARCHITECTURE 40）：瀏覽器端 JS 逐檔壓縮＋source map；原始碼與註解留在 src/client。MINIFY=off 可關
  const mz = await minifyDir(path.join(DIST, 'assets/js'));
  log(mz.skipped ? `JS 壓縮：略過（MINIFY=off），${mz.files} 檔` : `JS 壓縮 → assets/js：${mz.files} 檔，${(mz.before / 1024).toFixed(0)} KB → ${(mz.after / 1024).toFixed(0)} KB（另有 .js.map 供除錯）`);
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
  log(`JS 預算：公開頁最大 ${(jsb.public.max / 1024).toFixed(1)} KB（${jsb.public.maxPage}，預算 ${jsb.public.budgetKb} KB，${jsb.public.count} 頁）；含答案引擎的頁：立即載入最大 ${(jsb.engine.initialMax / 1024).toFixed(1)} KB（${jsb.engine.initialMaxPage}）、提問後合計最大 ${(jsb.engine.max / 1024).toFixed(1)} KB（${jsb.engine.maxPage}，預算 ${jsb.engine.budgetKb} KB，${jsb.engine.count} 頁）；後台頁最大 ${(jsb.admin.max / 1024).toFixed(1)} KB（${jsb.admin.maxPage}）`);
  if (!jsb.ok && mz.skipped) {
    console.warn('⚠ MINIFY=off：JS 預算以壓縮後的大小訂定，未壓縮建置只回報不擋（CI 一律壓縮）');
  } else if (!jsb.ok) {
    console.error(`❌ 有頁面的 JS 超過預算：${[...jsb.public.over, ...jsb.admin.over].slice(0, 10).map((r) => `${r.page} ${((r.engine ? r.total : r.bytes) / 1024).toFixed(1)}KB`).join('；')}`);
    process.exit(1);
  }
  // 第四十輪（Issue #80）：答案頁提問時下載的 JSON（gzip 後估算）。超過 ASK_DATA_BUDGET_KB（預設見 js-budget.mjs）⇒ 建置失敗
  const adb = checkAskDataBudget(DIST, { langs: config.langs.map((l) => l.code) });
  log(`答案頁資料傳輸量（gzip 估算）：${adb.rows.map((r) => `${r.lang} ${(r.bytes / 1024).toFixed(0)}KB`).join('、')}；專業版 ${(adb.pro.bytes / 1024).toFixed(0)}KB（預算 ${adb.budgetKb || '—'} KB；專業版預算 ${adb.proBudgetKb || '—'} KB）`);
  if (!adb.proOk) {
    console.error(`❌ 專業版答案資料傳輸量 ${(adb.pro.bytes / 1024).toFixed(1)} KB 超過預算 ${adb.proBudgetKb} KB（ASK_DATA_PRO_BUDGET_KB；最大的檔：${adb.pro.files.slice().sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, b]) => `${n} ${(b / 1024).toFixed(0)}KB`).join('、')}）`);
    process.exit(1);
  }
  if (!adb.publicOk) {
    console.error(`❌ 答案頁資料傳輸量超過預算 ${adb.budgetKb} KB：${adb.maxLang} ${(adb.max / 1024).toFixed(1)} KB（最大的檔：${adb.rows.find((r) => r.lang === adb.maxLang).files.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, b]) => `${n} ${(b / 1024).toFixed(0)}KB`).join('、')}）`);
    process.exit(1);
  }
  log(`輸出 ${pageCount} 頁 → dist/（${Date.now() - t0} ms）`);

  // 第二十八輪（ARCHITECTURE 31）：Pagefind 全文索引 → dist/pagefind/。必須在複製 PR 預覽之前（預覽各自有自己的索引，不能混進主站）
  const pfi = await buildPagefindIndex(DIST, { log });
  if (!pfi.skipped) log(`全文索引 → dist/pagefind/：${pfi.pages} 頁、語言 ${pfi.languages.join('／')}、${pfi.files} 檔 ${(pfi.bytes / 1024 / 1024).toFixed(1)} MB（執行期 ${(pfi.runtime / 1024).toFixed(0)} KB，第一次搜尋才載入）、${pfi.ms} ms`);
  // 第四十輪（Issue #79）：「頁面上有的詞必須搜得到」自我檢查——抽頁、抽 4–8 字中文、用 Node 查剛建好的索引，來源頁必須在結果中。
  // 有漏就列出來（警告）；召回低於 PAGEFIND_RECALL_MIN（預設 0.98）時 --check／CI 建置失敗。PAGEFIND_VERIFY=off 可略過。
  if (!pfi.skipped && process.env.PAGEFIND_VERIFY !== 'off') {
    const v = await verifyPagefindRecall(DIST);
    const min = Number(process.env.PAGEFIND_RECALL_MIN) || 0.98;
    log(`全文索引自我檢查：抽 ${v.pages} 頁 ${v.checked} 個 4–8 字中文字串，召回 ${(v.recall * 100).toFixed(1)}%（${v.hit}/${v.checked}）`);
    if (v.misses.length) console.warn(`⚠ 頁面上有、卻搜不到：${v.misses.slice(0, 10).map((m) => `${m.page}「${m.q}」`).join('；')}`);
    if (v.recall < min) {
      const strict = args.check || process.env.CI;
      console.error(`${strict ? '❌' : '⚠'} 全文索引召回 ${(v.recall * 100).toFixed(1)}% 低於 ${(min * 100).toFixed(0)}%（見 docs/ask-search-llm.md 第四十輪）`);
      if (strict) process.exit(1);
    }
  }

  // 全站連結完整性（站內連結必須指到存在的檔案；外部連結收集清單；佔位／示意網址 = error）
  // --check 或 CI 下有 error ⇒ exit 1；LINK_CHECK=warn 可暫時降為警告（整合期用），LINK_CHECK=off 略過。
  if (process.env.LINK_CHECK !== 'off') {
    const links = checkInternalLinks(DIST, { basePath: config.basePath, langs: config.langs, siteUrl: config.siteUrl, siblingUrls: [config.vaxmapUrl, config.vaxmapInfoUrl, config.denguemapUrl] });
    summarizeLinks(links, { limit: 50, log: (m) => console.log(m) });
    log('連結報告 → v1/governance/link-report.json、external-links.json');
    if (!links.ok) {
      const strict = (args.check || process.env.CI) && process.env.LINK_CHECK !== 'warn';
      console.error(`${strict ? '❌' : '⚠'} 站內連結檢查：${links.counts.errors} 個壞連結（${links.errorsByTarget.length} 種目標）${strict ? '，依治理門檻不得上線' : '（非 --check／CI，僅警告）'}`);
      if (strict) process.exit(1);
    }
  }

  // 第四十輪（#72、#73）：多語輸出品質，與連結檢查同層級（掃 dist 的可見文字）。
  //   詞彙鍵值外洩（term.*）＝一定是程式錯誤 ⇒ 不論 --check／CI 都讓建置失敗；
  //   外語頁中文比例＝先警告並列最差 10 頁（I18N_CJK_CHECK=error 可改擋、=off 關閉；門檻 I18N_CJK_MAX、白名單 I18N_CJK_ALLOW）。見 docs/i18n.md
  //   鍵值檢查沒有開關：它不會誤判（code／pre 已排除），關掉只會讓 term.influenza 再上線。
  {
    const q = checkI18nQuality(DIST);
    const { fail } = summarizeI18nQuality(q, { log: (m) => console.log(m) });
    writeOut('v1/governance/i18n-report.json', JSON.stringify({ generatedAt: site.today, threshold: q.cjk.threshold, checked: q.cjk.checked, over: q.cjk.over.length, byLang: q.cjk.byLang, worst: q.cjk.worst, termLeaks: q.termLeaks }, null, 2));
    if (fail) { console.error(`❌ 多語輸出檢查未通過（詞彙鍵值外洩 ${q.termLeaks.length} 頁${process.env.I18N_CJK_CHECK === 'error' ? `、中文比例超標 ${q.cjk.over.length} 頁` : ''}${q.cjk.strictOver.length ? `、首頁／問答頁中文比例超標 ${q.cjk.strictOver.length} 頁` : ''}）`); process.exit(1); }
  }

  // PR 預覽（17.2）：連結檢查之後才複製，預覽站不影響主站閘門
  const previews = process.env.PREVIEWS_DIR ? path.resolve(process.env.PREVIEWS_DIR) : null;
  // 第六十三輪：正式站不放 PR 預覽（未審核的內容與程式，每個預覽又是一整套含後台的站）
  if (previews && !config.isPrototype) log(`SITE_MODE=production：略過 PR 預覽（PREVIEWS_DIR=${previews}）`);
  else if (previews && fs.existsSync(previews)) {
    const dirs = fs.readdirSync(previews, { withFileTypes: true }).filter((e) => e.isDirectory() && /^pr-\d+$/.test(e.name)).map((e) => e.name);
    for (const d of dirs) copyDir(path.join(previews, d), path.join(DIST, 'preview', d));
    log(`PR 預覽 → dist/preview/：${dirs.length} 個（${dirs.join('、') || '無'}）`);
  } else if (previews) log(`PREVIEWS_DIR=${previews} 不存在，略過 PR 預覽`);

  // 第六十三輪（Issue #141）：部署產物白名單與對外資產清冊。放在最後：前面每一步（含複製預覽）都可能多放檔案，檢查的是「真正要部署的那一包」。
  //   原型：只盤點、不擋——後台、source map 等是示範站刻意公開的；清冊寫到 dist/headers/exposure.json 給資訊室看。
  //   正式：把只給同事的東西搬到 dist-internal/，再用 public 規則稽核一次公開樹；還有任何一個禁止路徑就建置失敗。
  const audit = auditDist(DIST, { profile: config.isPrototype ? 'prototype' : 'public' });
  if (config.isPrototype) {
    writeOut('headers/exposure.json', JSON.stringify(audit.inventory, null, 2) + '\n');
    log(`部署產物盤點（原型）：${audit.files} 檔；原型限定 ${audit.expected.map((e) => `${e.rule} ${e.count}`).join('、') || '無'}；防禦性規則命中 ${audit.forbidden.length}${audit.forbidden.length ? `（${audit.forbidden.slice(0, 5).map((f) => f.path).join('、')}）` : ''} → headers/exposure.json`);
    if (audit.forbidden.length) console.warn(`⚠ dist 有不該出現的檔案（正式建置會失敗）：${audit.forbidden.slice(0, 10).map((f) => `${f.path}［${f.rule}］`).join('；')}`);
  } else {
    const sp = splitForProduction(DIST, DIST_INTERNAL, { inventory: audit.inventory });
    log(`正式部署產物拆分 → ${DIST_INTERNAL.startsWith(ROOT + path.sep) ? path.relative(ROOT, DIST_INTERNAL) : DIST_INTERNAL}/：後台頁 ${sp.moved.admin} 檔、後台 JS ${sp.moved.assetsAdmin} 檔、vendor ${sp.moved.vendor} 檔、標頭設定 ${sp.moved.headers} 檔、source map ${sp.moved.maps} 個；刪除預覽 ${sp.deleted.previews} 檔、robots.production.txt ${sp.deleted.robotsProduction}；拿掉 ${sp.strippedSourceMapComments} 個 JS 的 sourceMappingURL；內部站共 ${sp.internalFiles} 檔`);
    const after = auditDist(DIST, { profile: 'public' });
    if (!after.ok) {
      console.error(`❌ 公開站產物仍有 ${after.forbidden.length} 個不得公開的檔案（docs/attack-surface.md）：`);
      for (const f of after.forbidden.slice(0, 30)) console.error(`  - ${f.path}［${f.rule}］${f.reason}`);
      process.exit(1);
    }
    log(`公開站產物稽核通過（profile public）：${after.files} 檔，無禁止路徑`);
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
