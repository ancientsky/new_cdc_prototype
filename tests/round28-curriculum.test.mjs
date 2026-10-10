// 第二十八輪（Issue #38）：傳染病核心教材示範匯入。
// 驗：重建版產生器可重現、schema 條件、治理（不進白名單、待辦文字）、答案單元（學習目標、章節錨點、待補不入索引）、
// 頁面呈現（文件頁、疾病頁專業區、/pro/、/pro/curriculum/）、舊站匯入第十二批（規則、草稿、清單、模擬匯出可重現）、評估集 r10。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { govern } from './helpers.mjs';
import { ROOT } from '../scripts/lib/load.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { buildCurriculumDoc, curriculumStats, withCite, pendingLine, PENDING_RE } from '../scripts/lib/curriculum.mjs';
import { validateDraft } from '../scripts/lib/legacy-import/validate.mjs';
import { loadRules, docTypeFor, matchUrlPattern } from '../scripts/lib/legacy-import/rules.mjs';
import { runImport } from '../scripts/lib/legacy-import/index.mjs';
import { generateCurriculum, PAGES } from '../scripts/lib/legacy-import/sim-export-curriculum.mjs';
import { engineFromSite } from '../eval/run-eval.mjs';
import * as documents from '../src/templates/public/documents.mjs';
import * as disease from '../src/templates/public/disease.mjs';
import * as proHome from '../src/templates/pro/home.mjs';
import * as proCurr from '../src/templates/pro/curriculum.mjs';

const D = 'doc.curriculum-dengue.2026-10-10';
const M = 'doc.curriculum-measles.2026-10-10';
const site = govern('2026-10-10');
site.searchIndex = buildSearchIndex(site);
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `r28-${name}-`));
const ctxOf = (lang = 'zh-TW', p = '/', extra = {}) => makeCtx(site, lang, { path: p, alternates: ['zh-TW', 'en'], ...extra });

// ───────────────────────── 產生器 ─────────────────────────

test('重建版產生器：來源檔 → 文件 JSON 可重現（已提交的檔案與重跑一致，sha256 是來源檔雜湊）', () => {
  for (const [slug, id] of [['dengue', D], ['measles', M]]) {
    const srcPath = path.join(ROOT, `data/curriculum/${slug}.source.json`);
    const buf = fs.readFileSync(srcPath);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const doc = JSON.parse(JSON.stringify(buildCurriculumDoc(JSON.parse(buf.toString('utf8')), { file: `${slug}.source.json`, sha256 })));
    const committed = readJSON(path.join(ROOT, `content/documents/${id.replace(/^doc\./, '')}.json`));
    assert.deepEqual(doc, committed, `${slug}：請重跑 node scripts/curriculum-to-doc.mjs`);
    assert.equal(committed.derivedFrom.sha256, sha256);
  }
});

test('重建版內容規則：每一條重點句都有出處代號、代號都在來源表、待補以全形括號開頭、七個章都在', () => {
  for (const id of [D, M]) {
    const d = site.byId.get(id);
    const codes = new Set(d.derivedFrom.sources.map((s) => s.label.split('｜')[0]));
    for (const s of d.sections.filter((x) => x.key !== 'sources')) {
      for (const line of String(s.markdown).split('\n').filter((l) => l.startsWith('- '))) {
        const m = /（出處 ([A-Z])[，）]/.exec(line);
        assert.ok(m, `${id}#${s.key} 沒有出處：${line.slice(0, 40)}`);
        assert.ok(codes.has(m[1]), `${id}#${s.key} 出處 ${m[1]} 不在來源表`);
      }
    }
    const st = curriculumStats(d);
    assert.equal(st.chapters, 7, `${id} 章數`);
    assert.ok(st.sourcedItems >= 15 && st.pending >= 1, `${id} 有出處的句子與待補都要有`);
    // 站內來源的 ref 要真的存在
    for (const s of d.derivedFrom.sources.filter((x) => x.ref)) assert.ok(site.byId.has(s.ref) || site.diseaseMasterById?.has?.(s.ref), `${id} 來源 ref ${s.ref} 不存在`);
    // 連不到的來源只能是 unreachable／unverified，不能宣稱 verified
    assert.ok(d.derivedFrom.sources.every((s) => s.status !== 'verified'), `${id} 不得宣稱已查證`);
  }
  assert.equal(withCite('潛伏期約 3-14 天。', '出處 A，第 3 頁'), '潛伏期約 3-14 天（出處 A，第 3 頁）。');
  assert.equal(pendingLine('治療章節'), '（待補：治療章節）');
  assert.ok(PENDING_RE.test(pendingLine('x')));
});

// ───────────────────────── schema 與治理 ─────────────────────────

test('schema：curriculum 必填學習目標、疾病、對象；重建版只能是 machine 且要有 sources；整站驗證零錯誤', () => {
  assert.deepEqual(validateSite(site), []);
  const base = JSON.parse(JSON.stringify(site.byId.get(D), (k, v) => (k === 'gov' || k.startsWith('__') ? undefined : v)));
  const err = (mut) => { const d = JSON.parse(JSON.stringify(base)); mut(d); return validateDraft({ ...d, status: 'review', aiWhitelist: { requested: false }, conversion: { confidence: 1 } }).filter((e) => e.startsWith('/')); };
  assert.deepEqual(err(() => {}), [], '原樣通過');
  assert.ok(err((d) => { delete d.learningObjectives; }).some((e) => e.includes('learningObjectives')));
  assert.ok(err((d) => { d.diseases = []; }).some((e) => e.includes('/diseases')));
  assert.ok(err((d) => { d.audience = ['public']; }).some((e) => e.includes('/audience')));
  assert.ok(err((d) => { d.derivedFrom.reviewStatus = 'reviewed'; }).some((e) => e.includes('/derivedFrom/reviewStatus')), '重建版不能標 reviewed');
  assert.ok(err((d) => { delete d.derivedFrom.sources; }).some((e) => e.includes('sources')));
  assert.deepEqual(err((d) => { d.docType = 'guideline'; delete d.learningObjectives; }), [], '別的 docType 不要求學習目標');
});

test('治理：重建版不進 AI 白名單、專業版仍可檢索；待辦文字是「取得正本、轉檔、刪除重建版」而不是「校對完改 reviewed」', () => {
  for (const id of [D, M]) {
    const d = site.byId.get(id);
    assert.equal(d.gov.whitelist.effective, false);
    assert.ok(d.gov.whitelist.reasons.includes('pdf-unreviewed'));
    const todo = site.gov.todos.find((t) => t.id === `pdf-unreviewed:${id}`);
    assert.ok(todo, `${id} 待辦`);
    assert.match(todo.text, /重建版/); assert.match(todo.text, /刪除本重建版/); assert.match(todo.text, /guide-staff §31/);
    assert.doesNotMatch(todo.text, /reviewStatus 改成 reviewed/);
  }
});

// ───────────────────────── 答案單元 ─────────────────────────

test('答案單元：只進專業索引；學習目標單獨一個單元（#objectives）；章節單元帶章節錨點；待補與「對照」導覽行、來源表不入索引', () => {
  const { pub, pro } = { pub: site.searchIndex.public, pro: site.searchIndex.pro };
  assert.ok(!pub.some((c) => c.contentId === D || c.contentId === M), '民眾索引沒有教材');
  for (const id of [D, M]) {
    const cs = pro.filter((c) => c.contentId === id);
    assert.ok(cs.length >= 8, `${id} 單元數 ${cs.length}`);
    const obj = cs.find((c) => c.id === `${id}#objectives`);
    assert.ok(obj && obj.url.endsWith('#objectives') && obj.sentences.every((s) => s.startsWith('學習目標 ')), `${id} 學習目標單元`);
    assert.equal(obj.sentences.length, site.byId.get(id).learningObjectives.length);
    for (const c of cs) {
      assert.ok(!c.sentences.some((s) => /（待補[:：]/.test(s) || /^對照：/.test(s)), `${c.id} 不得有待補或對照行`);
      assert.equal(c.extraction?.sourceKind, 'reconstructed');
      assert.equal(c.extraction?.reviewStatus, 'machine');
    }
    assert.ok(!cs.some((c) => c.id.endsWith('#sources')), '來源表不入索引');
  }
  // 登革熱第六章（治療）整章待補 ⇒ 沒有單元
  assert.ok(!pro.some((c) => c.id.startsWith(`${D}#ch6`)));
  assert.ok(pro.some((c) => c.id === `${D}#ch3-s2`));
});

test('智慧查詢（專業版）：引到章節單元與學習目標，來源卡標「尚未取得 PDF 正本」；版本題 V011 仍引用工作指引', async () => {
  const engine = engineFromSite(site);
  const r1 = await engine.answer('麻疹核心教材的學習目標', { view: 'pro', lang: 'zh-TW' });
  assert.ok(r1.sentences.some((s) => (s.cite ?? []).includes(`${M}#objectives`)), '引用學習目標單元');
  const src = r1.sources.find((s) => s.contentId === M);
  assert.ok(src, '來源有教材');
  assert.equal(src.extraction?.sourceKind, 'reconstructed');
  // render.js 需要瀏覽器 DOM（與 pdf-ingest 測試同做法）：只檢查來源卡依 sourceKind 換字
  const render = fs.readFileSync(path.join(ROOT, 'src/client/answer/render.js'), 'utf8');
  assert.match(render, /extractionReconstructed: '尚未取得 PDF 正本/);
  assert.match(render, /sourceKind === 'reconstructed' \? 'extractionReconstructed'/);
  const r2 = await engine.answer('登革熱核心教材 群聚解除', { view: 'pro', lang: 'zh-TW' });
  assert.ok(r2.sentences.some((s) => (s.cite ?? []).includes(`${D}#ch7-s3`) && s.text.includes('31 天')), '引用第七章第三節');
  const r3 = await engine.answer('登革熱核心教材 治療', { view: 'pro', lang: 'zh-TW' });
  assert.ok(!r3.sentences.some((s) => s.text.includes('待補')), '待補不得被當成答案');
  const v = await engine.answer('登革熱防治工作指引現行版是第幾版？', { view: 'pro', lang: 'zh-TW' });
  assert.ok(v.sources.some((s) => s.contentId === 'doc.guidance-dengue.2026-02'), 'V011：加入教材後仍引用工作指引');
  const pub = await engine.answer('麻疹核心教材的學習目標', { view: 'public', lang: 'zh-TW' });
  assert.ok(!(pub.sources ?? []).some((s) => s.contentId === M), '民眾版不引用教材');
});

// ───────────────────────── 頁面 ─────────────────────────

test('文件頁：長文件版面、示範匯入警示連到來源表、學習目標在頂端、章節錨點、對照連結', () => {
  const d = site.byId.get(D);
  const h = String(documents.render(ctxOf('zh-TW', '/documents/curriculum-dengue.2026-10-10/'), { item: d }));
  assert.match(h, /示範匯入，不是教材原文/);
  assert.match(h, /href="#s-sources"/);
  assert.match(h, /id="objectives"/);
  assert.ok(h.indexOf('id="objectives"') < h.indexOf('id="s-ch1-s1"'), '學習目標在第一章之前');
  for (const k of ['ch3-s2', 'ch7-s3', 'ch6', 'sources']) assert.match(h, new RegExp(`id="s-${k}"`), k);
  assert.match(h, /href="#objectives"/, '目錄有學習目標');
  assert.match(h, /（待補：/);
  const en = String(documents.render(ctxOf('en', '/en/documents/curriculum-dengue.2026-10-10/'), { item: d }));
  assert.match(en, /Demonstration import, not the original text/);
});

test('疾病頁專業區、/pro/、/pro/curriculum/：列出教材；/pro/curriculum/ 另列清單裡待移轉的教材與權責單位', () => {
  const dz = site.byId.get('disease.dengue');
  const h = String(disease.render(ctxOf('zh-TW', '/diseases/dengue/'), { item: dz }));
  assert.match(h, /id="pro-curriculum"/);
  assert.ok(h.includes('curriculum-dengue.2026-10-10'), '疾病頁連到登革熱教材');
  assert.ok(!h.includes('curriculum-measles.2026-10-10'), '不列別的疾病的教材');
  const home = String(proHome.render(ctxOf('zh-TW', '/pro/', { view: 'pro' })));
  assert.ok(home.includes('/pro/curriculum/') && home.includes('登革熱核心教材') && home.includes('麻疹核心教材'));
  assert.deepEqual(proCurr.pages(), [{ path: '/pro/curriculum/', lang: 'zh-TW' }, { path: '/pro/curriculum/', lang: 'en' }]);
  const pc = String(proCurr.render(ctxOf('zh-TW', '/pro/curriculum/', { view: 'pro' })));
  assert.ok(pc.includes('登革熱核心教材') && pc.includes('麻疹核心教材'));
  assert.deepEqual(proCurr.pendingCurricula(site).map((i) => i.key), ['novel-influenza-a', 'plague']);
  assert.ok(pc.includes('新型A型流感核心教材') && pc.includes('鼠疫核心教材') && pc.includes('新興傳染病整備組'));
});

// ───────────────────────── 舊站匯入第十二批 ─────────────────────────

test('規則檔第 11 版：標題「核心教材」⇒ curriculum，蓋過 DiseaseTeach 網址模式；其他 DiseaseTeach 頁照舊是 guideline', () => {
  const rules = loadRules();
  assert.equal(rules.version, 11);
  const u = 'https://www.cdc.gov.tw/Category/DiseaseTeach/abc';
  const pat = matchUrlPattern(rules, u);
  assert.equal(pat.id, 'disease-docs');
  assert.deepEqual(docTypeFor(rules, '登革熱核心教材', pat, u), { docType: 'curriculum', clear: true, strong: true });
  assert.equal(docTypeFor(rules, '人口密集機構感染管制措施指引', pat, u).docType, 'guideline', '第七批的 DiseaseTeach 指引不受影響');
  assert.equal(docTypeFor(rules, '麻疹防治工作手冊', matchUrlPattern(rules, '/Category/DiseaseManual/x'), '/Category/DiseaseManual/x').docType, 'manual');
});

test('已提交的第十二批輸出（data/legacy-import/core-curriculum）：5 頁、教材 4 份草稿過 schema、2 份對到既有示範匯入版、列表頁不轉、清單 verified 全是 false', () => {
  const dir = path.join(ROOT, 'data/legacy-import/core-curriculum');
  const r = readJSON(path.join(dir, 'report.json'));
  assert.equal(r.simulated, true);
  assert.equal(r.summary.pages, 5); assert.equal(r.summary.schemaInvalid, 0); assert.equal(r.summary.issues.error, 0);
  assert.equal(r.migration.applied, true); assert.equal(r.manifest.file, 'content/migration/core-curriculum.json');
  const by = (k) => r.pages.find((p) => p.key === k);
  for (const p of PAGES) {
    const pg = r.pages.find((x) => x.source.tab === p.key);
    assert.equal(pg.kind, 'document', p.key);
    assert.ok(pg.issues.some((i) => i.code === 'doctype-from-title'), `${p.key} 記下標題蓋過網址`);
    assert.ok(pg.issues.some((i) => i.code === 'pdf-only'), `${p.key} 純 PDF 頁`);
    const draft = readJSON(path.join(dir, pg.outputs[0].file));
    assert.equal(draft.docType, 'curriculum'); assert.ok(draft.audience.includes('professional'));
    assert.match(draft.learningObjectives[0], /^（待補/); assert.equal(draft.curriculum.chapterPlan, 'provisional');
    assert.ok(draft.family.startsWith('doc.curriculum-'), draft.family);
    assert.equal(draft.status, 'review'); assert.equal(draft.aiWhitelist.requested, false);
  }
  assert.equal(by('01-curriculum-dengue').outputs[0].id, D); assert.equal(by('01-curriculum-dengue').action, 'compare-existing');
  assert.equal(by('02-curriculum-measles').outputs[0].id, M);
  assert.ok(by('02-curriculum-measles').issues.some((i) => i.code === 'date-missing'), '麻疹頁沒有日期 ⇒ 不編日期');
  assert.equal(by('03-curriculum-novel-influenza-a').owner, 'unit.preparedness');
  assert.equal(by('05-core-curriculum-list').action, 'skip-list'); assert.equal(by('05-core-curriculum-list').owner, 'unit.oasis');
  const manifest = readJSON(path.join(ROOT, 'content/migration/core-curriculum.json'));
  assert.ok(manifest.items.every((i) => i.verified === false));
  assert.deepEqual(manifest.items.map((i) => `${i.key}:${i.status}`), ['core-curriculum-list:merged', 'dengue:migrated', 'measles:migrated', 'novel-influenza-a:pending', 'plague:pending']);
  const svc = site.migrationLists.find((m) => m.id === 'migration.legacy-services').items.find((i) => i.key === 'core-curriculum');
  assert.equal(svc.status, 'merged'); assert.equal(svc.newPath, '/pro/curriculum/');
});

test('第十二批可重現：模擬匯出重產一致、以提交時的清單重跑匯入，草稿與已提交的相同', () => {
  const exp = tmp('exp');
  generateCurriculum(exp);
  const committedExp = path.join(ROOT, 'data/legacy-export/core-curriculum');
  for (const f of fs.readdirSync(committedExp).filter((x) => x.endsWith('.json'))) assert.deepEqual(readJSON(path.join(exp, f)), readJSON(path.join(committedExp, f)), f);
  assert.equal(readJSON(path.join(exp, '_export.json')).simulated, true);
  // 清單 note 已帶【匯入】標記：重跑用一份複本，草稿逐份比對
  const mf = path.join(tmp('mf'), 'core-curriculum.json');
  fs.copyFileSync(path.join(ROOT, 'content/migration/core-curriculum.json'), mf);
  const out = tmp('out');
  const { report } = runImport({ exportDir: committedExp, outDir: out, manifestPath: mf, slug: 'core-curriculum', now: '2026-10-10T03:00:00Z' });
  const dir = path.join(ROOT, 'data/legacy-import/core-curriculum');
  for (const d of report.drafts) assert.deepEqual(readJSON(path.join(out, d.file)), readJSON(path.join(dir, d.file)), d.file);
});

// ───────────────────────── 評估集 ─────────────────────────

test('評估集 r10：CUR001–CUR005 是專業題、requires 指向教材；版本說明含「r10 第二十八輪 核心教材」', () => {
  const es = readJSON(path.join(ROOT, 'content/governance/eval-set.json'));
  assert.match(es.version, /-r1\d$/);
  assert.ok(es.note.includes('r10 第二十八輪 核心教材'));
  const cur = es.questions.filter((c) => c.id.startsWith('CUR'));
  assert.equal(cur.length, 5);
  for (const c of cur) {
    assert.equal(c.view, 'pro'); assert.equal(c.category, 'professional');
    assert.ok(c.requires.every((x) => x === D || x === M), c.id);
  }
});
