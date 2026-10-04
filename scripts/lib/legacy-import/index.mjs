// 舊站匯出批次轉換主流程（ARCHITECTURE 17.3）。
//   runImport({ exportDir, outDir, rulesPath?, applyMigration?, manifestPath?, slug?, contentDir?, now? }) → { report, patch, drafts, outDir }
// 兩階段：
//   1. 逐頁分析（URL 模式、類別→owner、疾病、移轉清單比對）＋抽內容＋轉 Markdown＋宣告資產 ⇒ 「單元」（一頁可產生多個單元：Q&A 每題一筆、疾病子頁併成區塊）
//   2. 組草稿 ⇒ schema 驗證 ⇒ 寫檔 ⇒ report.json／report.md／migration-patch.json（--apply-migration 才寫回清單）
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, CONTENT, readJSON } from '../load.mjs';
import { config } from '../../../site.config.mjs';
import { readExport } from './reader.mjs';
import {
  loadRules, parseUrl, matchUrlPattern, bulletinType, ownerForCategory, detectDiseases, blockKeyFor, mergeBlockFor, docTypeFor, stripTitlePrefix,
  normTitle, manifestPathRegex, ageYears,
} from './rules.mjs';
import { extractPage, rewriteBody, toMd, splitSections, faqItems, bodyChecks, parseDate } from './convert.mjs';
import { tableProblems, plainText, textOf } from './html.mjs';
import { AssetBag, findExportFile } from './assets.mjs';
import { computeConfidence, needsReview, MARKDOWN_WARNING_CODES } from './confidence.mjs';
import { validateDraft } from './validate.mjs';
import { buildPatch, applyPatch } from './migration.mjs';
import { renderReportMd } from './report.mjs';

const h6 = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 6);
const DIRS = { disease: 'diseases', faq: 'faq', news: 'news', document: 'documents', page: 'pages' };
const BLOCK_ORDER = ['what-to-do', 'symptoms', 'transmission', 'prevention', 'treatment', 'vaccine', 'situation', 'faq'];
const CONTENT_DIRS = ['diseases', 'faq', 'news', 'documents', 'clarifications', 'vaccines', 'datasets', 'banners', 'pages', 'media', 'topics', 'services', 'publications', 'labtests', 'research', 'jobs', 'tenders'];
const idRest = (id) => String(id).replace(/^[a-z]+\./, '');
const uniqBy = (arr, f) => { const seen = new Set(); return arr.filter((x) => { const k = f(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** content/ 現有內容索引：id → { type, title, owner, file }；另建 faq 標題索引 */
export function loadContentIndex(contentDir = CONTENT) {
  const byId = new Map();
  const faqByTitle = new Map();
  for (const d of CONTENT_DIRS) {
    const dir = path.join(contentDir, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j?.id) {
          byId.set(j.id, { type: j.type, title: j.title, owner: j.owner, file: `content/${d}/${f}` });
          if (j.type === 'faq') faqByTitle.set(normTitle(j.question ?? j.title), j.id);
        }
      } catch { /* 壞檔略過；整站驗證會另外報 */ }
    }
  }
  return { byId, faqByTitle };
}

const summaryOf = (md, title, max = 120) => {
  // 摘要取前面的敘述段落：跳過表格、標題、圖片；第一段太短就接第二段
  const paras = String(md ?? '').split(/\n{2,}/).map((x) => x.trim()).filter((x) => x && !/^(\||#{1,6}\s|!\[|-{3,}$)/.test(x));
  const t = plainText(paras.slice(0, plainText(paras[0] ?? '').length < 40 ? 2 : 1).join('\n\n'));
  if (!t) return title;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'));
  return end >= 30 ? cut.slice(0, end + 1) : `${cut.slice(0, max - 1)}…`;
};

function parseVersion(title) {
  let m = /第([一二三四五六七八九十百零〇]+)版/.exec(title);
  if (m) return `第${m[1]}版`;
  m = /(\d{2,3})\.(\d{1,2})\.(\d{1,2})/.exec(title);
  if (m) return m[0];
  m = /((?:19|20)\d{2})\s*年版?/.exec(title);
  if (m) return `${m[1]} 年版`;
  return null;
}

const uniqIssues = (issues) => uniqBy(issues, (i) => `${i.code}|${i.message}`);

// ───────────────────────────────────────── 主流程 ─────────────────────────────────────────

export function runImport(opts) {
  const {
    exportDir, outDir, rulesPath, applyMigration = false, manifestPath, contentDir = CONTENT,
    now = new Date().toISOString(), log = () => {},
  } = opts;
  if (!exportDir) throw new Error('缺匯出目錄');
  if (!outDir) throw new Error('缺 --out');
  const rules = loadRules(rulesPath);
  const exp = readExport(exportDir);
  const slug = opts.slug ?? path.basename(path.resolve(exportDir));
  const out = path.resolve(outDir);
  const exportedAt = exp.meta.exportedAt ?? now.slice(0, 10);
  const convertedAt = now;
  const siteBase = rules.siteBase ?? 'https://www.cdc.gov.tw';

  const master = {
    units: readJSON(path.join(contentDir, 'master/units.json'), []),
    diseases: readJSON(path.join(contentDir, 'master/diseases.json'), []),
    periods: readJSON(path.join(contentDir, 'master/review-periods.json'), {}),
  };
  const unitIds = new Set(master.units.filter((u) => u.publishes !== false).map((u) => u.id));
  const diseaseById = new Map(master.diseases.map((d) => [d.id, d]));
  const diseaseShort = new Map((rules.diseases ?? []).map((d) => [d.id, d.short]));
  const index = loadContentIndex(contentDir);

  // 移轉清單（選用）
  const mfPath = manifestPath ?? path.join(contentDir, 'migration', `${slug}.json`);
  const manifest = fs.existsSync(mfPath) ? { path: mfPath, data: JSON.parse(fs.readFileSync(mfPath, 'utf8')) } : null;
  const mItems = manifest?.data.items ?? [];
  const mRegex = mItems.map((it) => ({ it, re: manifestPathRegex(it.oldUrl), frag: (String(it.oldUrl).split('#')[1] ?? ''), q: new URLSearchParams(String(it.oldUrl).split('#')[0].split('?')[1] ?? '') }));
  const mUsed = new Set();

  fs.rmSync(path.join(out, 'content'), { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const bags = new Map(); // draftId → AssetBag
  const bagOf = (id, stem) => {
    if (!bags.has(id)) bags.set(id, new AssetBag({ draftId: id, outDir: out, filesDir: exp.filesDir, fallbackStem: stem }));
    return bags.get(id);
  };
  const usedIds = new Map(); // draftId → page key（第一個產生者）
  const titleSeen = new Map(); // normTitle → page key
  const units = []; // 組草稿用
  const prs = []; // 每頁一筆報告紀錄

  // ───── 第一階段：逐頁 ─────
  for (const page of exp.pages) {
    const side = page.side ?? {};
    const pr = {
      key: page.name, htmlFile: page.htmlFile,
      source: { url: side.url ?? '', title: '', category: side.category ?? '', publishedAt: null, updatedAt: null, breadcrumbs: [], tab: side.tab ?? '' },
      pattern: null, kind: 'page', type: 'page', manifestKey: null, target: null, targetExists: false, targetType: null,
      owner: null, ownerRule: null, diseases: [], issues: [], outputs: [], flags: {}, typeClear: true, attachmentsOk: true, unique: true,
      word: null, stats: { images: 0, links: 0, legacyLinks: 0, attachments: 0 },
    };
    const issue = (code, severity, message) => pr.issues.push({ code, severity, message });
    const addIssues = (list) => { for (const i of list) pr.issues.push(i); };
    prs.push(pr);

    if (page.missingSide) issue('side-missing', 'warn', `缺同名側檔 ${page.name}.json，url／類別／日期無法取得`);
    const u = parseUrl(side.url ?? '', siteBase);
    const pat = side.url ? matchUrlPattern(rules, u) : null;
    const ext = extractPage(rules, page.html);
    const title = (side.title || ext.htmlTitle || page.name).trim();
    const breadcrumbs = side.breadcrumbs?.length ? side.breadcrumbs : ext.breadcrumbs;
    const publishedAt = side.publishedAt ?? ext.updatedAt ?? null;
    const updatedAt = side.updatedAt ?? ext.updatedAt ?? publishedAt;
    const tab = side.tab ?? u.hash ?? '';
    Object.assign(pr.source, { title, breadcrumbs, publishedAt: publishedAt ?? exportedAt, updatedAt, tab });
    if (!publishedAt) issue('date-missing', 'warn', `缺發布日，暫用匯出日 ${exportedAt}`);
    pr.word = ext.word;
    if (ext.word.elements) issue('word-cleaned', 'info', `清除 Word 貼上殘留 ${ext.word.elements} 處（mso 樣式 ${ext.word.styles}、Mso 類別 ${ext.word.classes}、命名空間標籤 ${ext.word.namespaced}）`);

    // 類別 → owner
    const category = side.category ?? '';
    const own = ownerForCategory(rules, category, breadcrumbs);
    const ds = detectDiseases(rules, master.diseases, [breadcrumbs.join('／'), title]);
    pr.diseases = ds.map((d) => d.id);
    let owner = own?.owner ?? null;
    if (!owner && rules.ownerFallbackToDisease && ds[0]) owner = diseaseById.get(ds[0].id)?.owner ?? null;
    pr.ownerRule = own?.rule ?? (owner ? 'disease-fallback' : null);
    if (!owner) {
      issue('unmapped-category', 'warn', `未對應類別「${category || '（無）'}」：規則檔 categoryOwners 沒有對應的權責單位，暫填 ${rules.defaultOwner ?? 'unit.oasis'}，請補規則或人工指定`);
      owner = rules.defaultOwner ?? 'unit.oasis';
    }
    pr.owner = owner;
    pr.ownerMapped = !!pr.ownerRule;

    // 移轉清單比對
    let mi = null;
    if (manifest && side.url) {
      const cands = mRegex.filter((m) => !mUsed.has(m.it.key) && m.re.test(u.path)
        && [...m.q.keys()].filter((k) => k.toLowerCase() !== 'page' && !/^\{/.test(m.q.get(k))).every((k) => u.query.get(k) === m.q.get(k)));
      const byTab = cands.filter((m) => m.frag && m.frag === tab);
      const byTitle = (arr) => arr.filter((m) => normTitle(stripTitlePrefix(rules, m.it.oldTitle)) === normTitle(stripTitlePrefix(rules, title)));
      const noFragCand = cands.filter((m) => !m.frag && !tab);
      mi = (byTab[0] ?? (byTitle(cands)[0]) ?? (cands.length === 1 && !cands[0].frag ? cands[0] : null) ?? noFragCand[0] ?? null)?.it ?? null;
      if (!mi && cands.length === 1 && !tab) mi = cands[0].it;
    }
    if (mi) {
      mUsed.add(mi.key);
      pr.manifestKey = mi.key; pr.target = mi.target ?? null;
      pr.manifestStatus = mi.status;
      if (mi.target) { const t = index.byId.get(mi.target); pr.targetExists = !!t; pr.targetType = t?.type ?? mi.target.split('.')[0]; }
    } else if (manifest) issue('not-in-manifest', 'warn', '移轉清單裡找不到對應的舊頁（建議新增一筆 pending 項目）');

    // 型別判斷
    const patKind = pat?.kind ?? 'page';
    pr.pattern = pat?.id ?? null;
    let kind = patKind;
    let blockKey = null;
    let primary = ds[0]?.id ?? null;
    pr.typeClear = !!pat && pat.typeClear !== false;
    if (!pat) issue('type-unclear', 'warn', `網址「${side.url || '（空）'}」不符任何 URL 模式，暫以 page 處理`);
    if (kind === 'page' && pat?.mergeable && primary) {
      const k = mergeBlockFor(rules, { title, breadcrumbs, category });
      if (k) { kind = 'disease-block'; blockKey = k; }
    }
    if (kind === 'disease-block' && !blockKey) blockKey = blockKeyFor(rules, title) ?? (tab ? blockKeyFor(rules, tab) : null);
    if (kind === 'disease-block' && !primary) { kind = 'page'; pr.typeClear = false; issue('type-unclear', 'warn', '疾病頁子頁，但從麵包屑與標題找不到疾病，改以 page 處理'); }
    if (kind === 'list') issue('list-page', 'info', '清單頁（連結集合）：新站的列表由系統依內容自動產生，通常不需轉換；草稿僅供比對連結');
    pr.kind = kind;
    pr.type = kind === 'disease-block' ? 'disease' : kind === 'faq' ? 'faq' : kind === 'news' ? 'news' : kind === 'document' ? 'document' : 'page';

    // 年代與處理旗標
    const hist = (rules.historicalKeywords ?? []).some((k) => breadcrumbs.join('／').includes(k) || title.includes(k));
    pr.flags.historical = hist;
    if (hist) issue('historical-version', 'info', '歷史版本：建議封存（舊版保留查閱），不取代現行版');
    const drop = (rules.dropRules ?? []).find((r) => r.titleKeywords?.some((k) => title.includes(k)) && (!r.publishedBefore || (publishedAt ?? exportedAt) < r.publishedBefore));
    if (drop) { pr.flags.drop = true; issue('old-content', 'info', drop.note); }
    const yrs = ageYears(updatedAt, exportedAt);
    if (!drop && yrs != null && yrs > (rules.thresholds?.archiveAfterYears ?? 3) && pr.kind !== 'document') { pr.flags.old = true; issue('old-content', 'info', `最後更新於 ${updatedAt}（${yrs.toFixed(1)} 年前），建議走久遠封存而非上線`); }

    // 抽內容：先決定輸出單元的 id，再改寫圖片與連結
    const dis = primary ? diseaseById.get(primary) : null;
    const short = diseaseShort.get(primary) ?? 'x';
    const attList = (side.attachments ?? []).map((a) => ({ ...a, file: a.file ?? decodeURIComponent(path.basename(parseUrl(a.url, siteBase).rawPath)) }));
    const attByPath = new Map();
    for (const a of attList) { const pu = parseUrl(a.url, siteBase); attByPath.set(`${pu.path}${pu.search}`.toLowerCase(), a); attByPath.set(pu.path.toLowerCase(), a); }
    pr.stats.attachments = attList.length;

    /** 為某 draftId 建改寫 ctx，並先把 sidecar 附件宣告進該 bag */
    const makeCtx = (draftId, stem, { withAttachments }) => {
      const bag = bagOf(draftId, stem);
      const fileOf = new Map();
      if (withAttachments) {
        for (const a of attList) {
          const r = bag.add({ src: a.file, as: 'attachment', label: a.label, pageKey: page.name });
          addIssues(r.issues);
          if (!r.ok) pr.attachmentsOk = false; else fileOf.set(a, r.file);
        }
      }
      return {
        siteBase, pageUrl: u.origin ? `${u.origin}${u.rawPath}${u.search}` : siteBase, fileLinkRe: rules.extraction?.attachmentLinkPattern,
        onImage: ({ src, alt, title: t }) => {
          const name = decodeURIComponent(path.basename(parseUrl(src, siteBase).rawPath));
          const r = bag.add({ src: name, as: 'image', alt, title: t, pageKey: page.name });
          addIssues(r.issues);
          if (!r.ok) { pr.attachmentsOk = false; return null; }
          return { src: `/files/${draftId}/${r.file}`, alt: r.asset.alt };
        },
        onLink: (abs) => {
          const a = attByPath.get(`${decodeURIComponent(abs.pathname)}${abs.search}`.toLowerCase()) ?? attByPath.get(decodeURIComponent(abs.pathname).toLowerCase());
          if (!a) return null;
          const f = fileOf.get(a);
          return f ? `/files/${draftId}/${f}` : ''; // '' ＝ 側檔有列但檔案缺（已報 attachment-missing），不再重複報
        },
      };
    };
    const afterRewrite = (stat) => {
      pr.stats.images += stat.images; pr.stats.links += stat.links; pr.stats.legacyLinks += stat.legacyLinks;
      for (const l of stat.unlistedFileLinks) { pr.attachmentsOk = false; issue('unlisted-file-link', 'warn', `內文有檔案連結 ${l} 不在側檔 attachments，未轉成附件`); }
      for (const m of stat.missingImages) issue('image-missing', 'error', `圖片 ${m} 找不到檔案`);
    };
    const checks = (markdown, nodeForTables, stat, dropped) => addIssues(bodyChecks({ markdown, dropped, tables: tableProblems(nodeForTables), media: stat.media, minChars: rules.thresholds?.minBodyChars ?? 40 }));
    const reserveId = (wanted, fallback) => {
      let id = wanted;
      if (usedIds.has(id)) { id = fallback; let n = 2; const base = id; while (usedIds.has(id)) id = `${base}-${n++}`; }
      usedIds.set(id, page.name);
      return id;
    };
    const shortKey = pr.manifestKey ?? h6(side.url || page.name);
    const slugStem = pr.manifestKey ? (pr.manifestKey.startsWith(`${short}-`) ? pr.manifestKey : `${short}-${pr.manifestKey}`) : `${short}-${shortKey}`;

    if (kind === 'disease-block') {
      // 併入疾病頁：id＝disease.xxx（多頁共用一份草稿）
      const draftId = primary;
      const ctx = makeCtx(draftId, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const unitBase = { pageKey: page.name, kind, type: 'disease', draftId, diseaseId: primary };
      const heading = (rules.blockHeadings ?? {});
      if (blockKey) {
        const { markdown, dropped } = toMd(ext.body.children);
        checks(markdown, ext.body, stat, dropped);
        units.push({ ...unitBase, blocks: [{ key: blockKey, heading: heading[blockKey] ?? blockKey, markdown, source: page.name }] });
        pr.outputs.push({ id: draftId, type: 'disease', role: 'merged', block: blockKey });
      } else {
        // 疾病介紹總覽：前言→摘要，各小節依標題關鍵字進區塊
        const { preamble, sections } = splitSections(ext.body);
        const pre = toMd(preamble);
        const blocks = [];
        const unassigned = [];
        let dropped = [...pre.dropped];
        let allMd = pre.markdown;
        for (const s of sections) {
          const k = blockKeyFor(rules, s.heading);
          const r = toMd(s.nodes);
          dropped = dropped.concat(r.dropped);
          allMd += `\n\n${r.markdown}`;
          if (k) blocks.push({ key: k, heading: heading[k] ?? k, markdown: r.markdown ? `### ${s.heading}\n\n${r.markdown}` : '', source: page.name });
          else {
            unassigned.push({ heading: s.heading, markdown: r.markdown });
            issue('section-unassigned', 'warn', `小節「${s.heading}」標題沒有對到任何區塊關鍵字，未併入；內容保留在草稿的 conversion.unassigned`);
          }
        }
        checks(allMd, ext.body, stat, dropped);
        units.push({ ...unitBase, blocks, summaryMd: pre.markdown, unassigned });
        pr.outputs.push({ id: draftId, type: 'disease', role: 'merged', block: blocks.map((b) => b.key).join('、') || null });
        if (!blocks.length) { pr.typeClear = false; issue('type-unclear', 'warn', '疾病介紹總覽沒有任何小節對到區塊'); }
      }
    } else if (kind === 'faq') {
      let items = faqItems(rules, ext.container);
      if (!items.length) {
        issue('faq-structure-missing', 'warn', '找不到 Q&A 結構（.panel／.panel-title／.panel-body），整頁當作一題處理');
        items = [{ question: stripTitlePrefix(rules, title), answerNode: ext.body }];
      }
      let first = true;
      for (const it of items) {
        const nq = normTitle(it.question);
        let id = index.faqByTitle.get(nq) ?? (items.length === 1 && pr.target?.startsWith('faq.') ? pr.target : null) ?? `faq.${short}-legacy-${h6(it.question)}`;
        if (usedIds.has(id)) {
          pr.unique = false;
          pr.outputs.push({ id, type: 'faq', role: 'duplicate', duplicateOf: usedIds.get(id) });
          issue('duplicate-title', 'warn', `問題「${it.question}」已由 ${usedIds.get(id)} 轉出（${id}），本頁不重複輸出`);
          continue;
        }
        usedIds.set(id, page.name);
        const ctx = makeCtx(id, `${short}-q`, { withAttachments: first && attList.length > 0 });
        first = false;
        const stat = rewriteBody(it.answerNode, ctx);
        afterRewrite(stat);
        const { markdown, dropped } = toMd(it.answerNode.children);
        checks(markdown, it.answerNode, stat, dropped);
        units.push({ pageKey: page.name, kind, type: 'faq', draftId: id, question: it.question, markdown, diseaseId: primary, publishedAt: publishedAt ?? exportedAt });
        pr.outputs.push({ id, type: 'faq', role: 'draft' });
      }
    } else if (kind === 'news') {
      const bt = bulletinType(rules, u);
      if (!bt || bt.unknown) { pr.typeClear = false; issue('type-unclear', 'warn', bt ? `Bulletin typeid=${bt.typeid} 不在規則檔 bulletinTypes，暫以其他訊息（other）處理` : '網址沒有 typeid，暫以其他訊息（other）處理'); }
      if (bt?.hint) issue('news-type-hint', 'info', bt.hint);
      const id = reserveId(pr.target?.startsWith('news.') ? pr.target : `news.${(publishedAt ?? exportedAt)}-legacy-${h6(side.url)}`, `news.${publishedAt ?? exportedAt}-legacy-${h6(side.url + page.name)}`);
      const ctx = makeCtx(id, `${short}-news`, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      units.push({ pageKey: page.name, kind, type: 'news', draftId: id, title: stripTitlePrefix(rules, title), markdown, newsType: bt?.newsType ?? 'other', lang: bt?.lang, diseaseId: primary, publishedAt: publishedAt ?? exportedAt });
      pr.outputs.push({ id, type: 'news', role: 'draft' });
    } else if (kind === 'document') {
      const dt = docTypeFor(rules, title, pat, u);
      if (!dt.clear) issue('doctype-guessed', 'info', '標題與網址看不出文件種類，暫填 guideline');
      const eff = publishedAt ?? exportedAt;
      const family0 = pr.target?.startsWith('doc.') ? pr.target.replace(/\.\d{4}-\d{2}-\d{2}$/, '') : `doc.${short}-${pr.manifestKey ?? h6(side.url)}`;
      let id = pr.target?.startsWith('doc.') ? pr.target : `${family0}.${eff}`;
      if (usedIds.has(id)) {
        issue('target-shared', 'info', `與 ${usedIds.get(id)} 指向同一個對應 ${id}（不同版次），改以 ${family0}.${eff} 另列一版`);
        id = `${family0}.${eff}`;
      }
      id = reserveId(id, `${family0}.${eff}`);
      const family = id.replace(/\.\d{4}-\d{2}-\d{2}(-\d+)?$/, '');
      const ctx = makeCtx(id, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      const version = parseVersion(title);
      if (!version) issue('version-unknown', 'info', `標題看不出版次，version 暫填 ${eff}`);
      units.push({ pageKey: page.name, kind, type: 'document', draftId: id, title: stripTitlePrefix(rules, title), markdown, docType: dt.docType, version: version ?? eff, effectiveAt: eff, family, diseaseId: primary, publishedAt: eff });
      pr.outputs.push({ id, type: 'document', role: 'draft' });
    } else {
      // page（含清單頁）
      const wanted = pr.target?.startsWith('page.') ? pr.target : `page.${slugStem}`;
      const id = reserveId(wanted, `page.${short}-${shortKey}-${h6(side.url + page.name)}`);
      const ctx = makeCtx(id, slugStem, { withAttachments: true });
      const stat = rewriteBody(ext.body, ctx);
      afterRewrite(stat);
      const { markdown, dropped } = toMd(ext.body.children);
      checks(markdown, ext.body, stat, dropped);
      units.push({ pageKey: page.name, kind, type: 'page', draftId: id, title: stripTitlePrefix(rules, title), markdown, diseaseId: primary, publishedAt: publishedAt ?? exportedAt });
      pr.outputs.push({ id, type: 'page', role: 'draft' });
      if (pr.targetExists && pr.targetType !== 'page') issue('target-type-differs', 'info', `對應的新站內容是 ${pr.target}（${pr.targetType}），草稿以 page 暫存，請比對後改建為 ${pr.targetType}`);
    }

    // 重複標題（非 FAQ）
    if (kind !== 'faq') {
      const nt = normTitle(stripTitlePrefix(rules, title));
      if (titleSeen.has(nt)) { pr.unique = false; issue('duplicate-title', 'warn', `標題與 ${titleSeen.get(nt)} 重複`); } else titleSeen.set(nt, page.name);
    }
    pr.issues = uniqIssues(pr.issues);
  }

  // ───── 信心、處理狀態與建議動作 ─────
  const weights = rules.confidence ?? {};
  for (const pr of prs) {
    const markdownClean = !pr.issues.some((i) => MARKDOWN_WARNING_CODES.has(i.code));
    const attOk = pr.attachmentsOk && !pr.issues.some((i) => ['attachment-missing', 'asset-too-large', 'asset-ext-not-allowed', 'unlisted-file-link'].includes(i.code));
    const { confidence, parts } = computeConfidence({ typeClear: pr.typeClear, ownerMapped: pr.ownerMapped, markdownClean, attachmentsOk: attOk, unique: pr.unique }, weights);
    pr.confidence = confidence; pr.parts = parts;
    pr.needsReview = needsReview(confidence, rules);
    pr.existing = pr.targetExists || pr.outputs.some((o) => o.role !== 'duplicate' && index.byId.has(o.id));
    pr.compareWith = uniqBy([...pr.outputs.filter((o) => index.byId.has(o.id)).map((o) => o.id), ...(pr.targetExists ? [pr.target] : [])].map((id) => ({ id })), (x) => x.id).map((x) => x.id);
    pr.action = decideAction(pr, rules);
  }

  // ───── 第二階段：組草稿 ─────
  const drafts = [];
  const common = (id, type, title, extra) => {
    const published = extra.publishedAt ?? exportedAt;
    return {
      id, type, title,
      ...extra.head,
      owner: extra.owner, publishedAt: published, reviewedAt: exportedAt, reviewPeriodMonths: master.periods[type] ?? 12, status: 'review',
      audience: extra.audience, sensitivity: 'public', license: 'OGDL-1.0',
      ...(extra.diseases?.length ? { diseases: extra.diseases } : {}),
      aiWhitelist: { requested: false }, languages: { 'zh-TW': { status: 'source' } },
      ...(extra.sourceLang ? { sourceLang: extra.sourceLang } : {}),
      summary: extra.summary,
    };
  };
  const prByKey = new Map(prs.map((p) => [p.key, p]));
  const audienceFor = (type, pr) => (pr && (rules.audience?.professionalCategories ?? []).some((c) => (pr.source.category + pr.source.breadcrumbs.join('／')).includes(c)) && type !== 'disease' ? ['professional'] : (rules.audience?.byType?.[type] ?? ['public']));
  const ownerOf = (pr) => pr.owner;
  const finish = (draft, srcPrs, extraConv = {}) => {
    const bag = bags.get(draft.id);
    const issuesRaw = uniqIssues(srcPrs.flatMap((p) => p.issues));
    const wc = issuesRaw.filter((i) => i.code === 'word-cleaned');
    const issuesAll = wc.length > 1
      ? [...issuesRaw.filter((i) => i.code !== 'word-cleaned'), { code: 'word-cleaned', severity: 'info', message: `清除 Word 貼上殘留共 ${wc.reduce((a, i) => a + Number(/殘留 (\d+) 處/.exec(i.message)?.[1] ?? 0), 0)} 處（${wc.length} 個來源頁）` }]
      : issuesRaw;
    const conf = Math.round((srcPrs.reduce((a, p) => a + p.confidence, 0) / srcPrs.length) * 100) / 100;
    draft.legacyUrls = uniqBy(srcPrs.map((p) => p.source.url).filter((x) => /^https?:\/\//.test(x)), (x) => x);
    if (bag?.assets.length) draft.assets = bag.assets;
    const compare = uniqBy([...(index.byId.has(draft.id) ? [{ id: draft.id }] : []), ...srcPrs.filter((p) => p.targetExists && p.outputs.filter((o) => o.role !== 'duplicate').length === 1).map((p) => ({ id: p.target }))], (x) => x.id).map((x) => x.id);
    draft.conversion = {
      mode: 'auto', confidence: conf, issues: issuesAll.map(({ code, severity, message }) => ({ code, severity, message })),
      sourceUrl: srcPrs[0].source.url, convertedAt,
      ...(srcPrs.length > 1 ? { sourceUrls: uniqBy(srcPrs.map((p) => p.source.url), (x) => x) } : {}),
      ...(compare.length ? { existing: true, compareWith: compare } : {}),
      ...extraConv,
    };
    return draft;
  };

  const diseaseUnits = new Map();
  for (const un of units) if (un.type === 'disease') { if (!diseaseUnits.has(un.draftId)) diseaseUnits.set(un.draftId, []); diseaseUnits.get(un.draftId).push(un); }

  for (const un of units) {
    const pr = prByKey.get(un.pageKey);
    if (un.type === 'disease') continue;
    const dmeta = un.diseaseId ? diseaseById.get(un.diseaseId) : null;
    const diseases = uniqBy([...(un.diseaseId ? [un.diseaseId] : []), ...pr.diseases.slice(1)].map((id) => ({ id })), (x) => x.id).map((x) => x.id);
    const base = (title, summaryMd, type) => common(un.draftId, type, title, { owner: ownerOf(pr), publishedAt: un.publishedAt, audience: audienceFor(type, pr), diseases, summary: summaryOf(summaryMd, title) });
    let d;
    if (un.type === 'faq') {
      d = base(un.question, un.markdown, 'faq');
      Object.assign(d, { question: un.question, answerMarkdown: un.markdown });
      if (un.diseaseId) d.basedOn = [un.diseaseId];
    } else if (un.type === 'news') {
      d = base(un.title, un.markdown, 'news');
      d.reviewPeriodMonths = master.periods.news ?? 0;
      Object.assign(d, { newsType: un.newsType, bodyMarkdown: un.markdown });
      if (un.lang && un.lang !== 'zh-TW') d.sourceLang = un.lang;
    } else if (un.type === 'document') {
      d = base(un.title, un.markdown, 'document');
      Object.assign(d, { family: un.family, docType: un.docType, version: un.version, effectiveAt: un.effectiveAt, machineReadableMarkdown: un.markdown });
      const bag = bags.get(un.draftId);
      const pdf = bag?.assets.find((a) => a.file.endsWith('.pdf') && a.kind === 'attachment');
      if (pdf) d.pdfUrl = `/files/${un.draftId}/${pdf.file}`;
    } else {
      d = base(un.title, un.markdown, 'page');
      Object.assign(d, { slug: idRest(un.draftId), bodyMarkdown: un.markdown });
    }
    drafts.push(finish(d, [pr]));
  }

  for (const [id, us] of diseaseUnits) {
    const dm = diseaseById.get(id);
    const srcPrs = uniqBy(us.map((x) => prByKey.get(x.pageKey)), (p) => p.key);
    const bmap = new Map();
    for (const un of us) for (const b of un.blocks) {
      if (!bmap.has(b.key)) bmap.set(b.key, { key: b.key, heading: b.heading, parts: [] });
      if (b.markdown) bmap.get(b.key).parts.push(b.markdown);
    }
    const blocks = BLOCK_ORDER.map((k) => {
      const e = bmap.get(k);
      const md = e?.parts.join('\n\n') ?? '';
      return md ? { key: k, heading: e.heading, markdown: md } : { key: k, heading: rules.blockHeadings?.[k] ?? k, markdown: '', status: 'pending' };
    });
    const firstSentence = (k) => { const b = blocks.find((x) => x.key === k); const t = plainText((b?.markdown ?? '').split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n')); return t ? summaryOf(t, '', 60) : '（待補：舊頁沒有對應段落）'; };
    const intro = us.find((x) => x.summaryMd);
    const unassigned = us.flatMap((x) => x.unassigned ?? []);
    const prFirst = srcPrs[0];
    const d = common(id, 'disease', dm?.name ?? id, {
      owner: dm?.owner ?? ownerOf(prFirst), publishedAt: prFirst.source.publishedAt, audience: rules.audience?.byType?.disease ?? ['public', 'professional'], diseases: [id],
      summary: summaryOf(intro?.summaryMd || blocks.find((b) => b.markdown)?.markdown || '', dm?.name ?? id),
      head: { slug: dm?.slug ?? idRest(id), nameEn: dm?.nameEn ?? '' },
    });
    // 疾病頁固定欄位：從主檔帶入，舊頁文字只進 blocks
    Object.assign(d, {
      aliases: dm?.aliases ?? [], legalCategory: dm?.legalCategory ?? 3, icd10: dm?.icd10 ?? [], ...(dm?.notifyWithinHours != null ? { notifyWithinHours: dm.notifyWithinHours } : {}), transmission: dm?.transmission ?? [],
      keyFacts: { symptoms: firstSentence('symptoms'), transmission: firstSentence('transmission'), prevention: firstSentence('prevention') },
      blocks,
    });
    // 欄位順序：head 先、再治理欄位——common 已處理；slug／nameEn 放在 head
    const extra = { mergedFrom: srcPrs.map((p) => ({ page: p.key, url: p.source.url, blocks: us.filter((x) => x.pageKey === p.key).flatMap((x) => x.blocks.map((b) => b.key)) })) };
    if (intro?.summaryMd) extra.introMarkdown = intro.summaryMd;
    if (unassigned.length) extra.unassigned = unassigned;
    drafts.push(finish(d, srcPrs, extra));
  }

  // ───── 驗證與寫檔 ─────
  const env = { units: unitIds, diseaseIds: new Set(master.diseases.map((d) => d.id)), licenses: config.licenses?.allowed, assetsDir: path.join(out, 'content/assets') };
  const draftRecs = [];
  for (const d of drafts) {
    const rel = `content/${DIRS[d.type]}/${idRest(d.id)}.json`;
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), `${JSON.stringify(d, null, 2)}\n`);
    const errors = validateDraft(d, env);
    draftRecs.push({
      id: d.id, type: d.type, title: d.title, file: rel, confidence: d.conversion.confidence, existing: !!d.conversion.existing, compareWith: d.conversion.compareWith ?? [],
      status: d.status, owner: d.owner, assets: (d.assets ?? []).length, schemaValid: errors.length === 0, errors,
      sourcePages: uniqBy(units.filter((x) => x.draftId === d.id).map((x) => ({ k: x.pageKey })), (x) => x.k).map((x) => x.k),
      merged: d.type === 'disease',
    });
  }
  for (const pr of prs) {
    for (const o of pr.outputs) {
      const rec = draftRecs.find((r) => r.id === o.id);
      if (rec) { o.file = rec.file; o.schemaValid = rec.schemaValid; }
      if (rec && !rec.schemaValid) pr.issues.push({ code: 'schema-invalid', severity: 'error', message: `草稿 ${rec.id} 未通過 schema 驗證：${rec.errors.slice(0, 3).join('；')}` });
    }
  }

  // ───── 報告與移轉清單 ─────
  const patch = buildPatch({ manifest, prs, units, index, exportedAt, slug, rules });
  const sum = summarize({ prs, draftRecs, bags, patch, manifest, exp, exportedAt });
  const report = {
    format: 'cdc-legacy-import-report/1',
    batch: slug, generatedAt: convertedAt, exportedAt, simulated: exp.meta.simulated === true,
    source: { dir: path.relative(ROOT, exp.dir) || exp.dir, note: exp.meta.source ?? null, site: exp.meta.site ?? siteBase },
    rules: { file: rules.__file, version: rules.version },
    manifest: manifest ? { id: manifest.data.id, file: path.relative(ROOT, manifest.path), items: mItems.length } : null,
    summary: sum,
    pages: prs.map((p) => ({
      key: p.key, file: p.htmlFile, source: { url: p.source.url, title: p.source.title, category: p.source.category, publishedAt: p.source.publishedAt, updatedAt: p.source.updatedAt, breadcrumbs: p.source.breadcrumbs, tab: p.source.tab },
      pattern: p.pattern, kind: p.kind, type: p.type, manifestKey: p.manifestKey, target: p.target, targetExists: p.targetExists, existing: p.existing, compareWith: p.compareWith,
      owner: p.owner, ownerRule: p.ownerRule, diseases: p.diseases, outputs: p.outputs, confidence: p.confidence, parts: p.parts, needsReview: p.needsReview,
      issues: p.issues, action: p.action, flags: p.flags, stats: p.stats,
    })),
    drafts: draftRecs,
    migration: { patchFile: 'migration-patch.json', applied: false, summary: patch.summary },
  };
  fs.writeFileSync(path.join(out, 'migration-patch.json'), `${JSON.stringify(patch, null, 2)}\n`);
  if (applyMigration) {
    if (!manifest) throw new Error(`找不到移轉清單 ${path.relative(ROOT, mfPath)}，無法 --apply-migration`);
    const res = applyPatch(manifest.path, patch);
    report.migration = { ...report.migration, applied: true, file: path.relative(ROOT, manifest.path), ...res };
    patch.applied = res;
    fs.writeFileSync(path.join(out, 'migration-patch.json'), `${JSON.stringify(patch, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'report.md'), renderReportMd(report, patch));
  log(`輸出 ${drafts.length} 份草稿 → ${path.relative(ROOT, out)}`);
  return { report, patch, drafts, outDir: out };
}

export function decideAction(pr, rules) {
  if (pr.flags.drop) return 'drop';
  if (pr.flags.historical) return 'archive';
  if (pr.kind === 'list' && !pr.stats.attachments && !pr.stats.images) return 'skip-list';
  if (pr.needsReview) return 'manual-review';
  if (pr.kind === 'disease-block') return 'merge-into-disease';
  if (pr.existing) return 'compare-existing';
  if (pr.flags.old) return 'archive';
  if (pr.kind === 'news' && pr.confidence >= (rules.thresholds?.autoConfidence ?? 0.8) && !pr.issues.some((i) => i.severity !== 'info')) return 'auto-ok';
  return 'review-before-publish';
}

function summarize({ prs, draftRecs, bags, patch, manifest, exp, exportedAt }) {
  const byType = {};
  for (const d of draftRecs) byType[d.type] = (byType[d.type] ?? 0) + 1;
  const byKind = {};
  for (const p of prs) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const byAction = {};
  for (const p of prs) byAction[p.action] = (byAction[p.action] ?? 0) + 1;
  const asset = { total: 0, attachment: 0, image: 0, data: 0, needsAlt: 0, noTextLayer: 0 };
  for (const b of bags.values()) { const s = b.summary(); for (const k of Object.keys(asset)) asset[k] += s[k]; }
  const avg = prs.length ? Math.round((prs.reduce((a, p) => a + p.confidence, 0) / prs.length) * 100) / 100 : 0;
  return {
    pages: prs.length, drafts: draftRecs.length, mergedPages: prs.filter((p) => p.kind === 'disease-block').length,
    byType, byKind, byAction, avgConfidence: avg, needsReview: prs.filter((p) => p.needsReview).length,
    existing: prs.filter((p) => p.existing).length, schemaInvalid: draftRecs.filter((d) => !d.schemaValid).length,
    assets: asset, issues: { error: prs.flatMap((p) => p.issues).filter((i) => i.severity === 'error').length, warn: prs.flatMap((p) => p.issues).filter((i) => i.severity === 'warn').length, info: prs.flatMap((p) => p.issues).filter((i) => i.severity === 'info').length },
    manifest: manifest ? { items: manifest.data.items.length, matched: patch.summary.matched, missingPages: patch.summary.missingPages } : null,
    exportedAt, pagesWithoutOutput: prs.filter((p) => !p.outputs.length).length,
  };
}

export { findExportFile, parseDate, textOf };
