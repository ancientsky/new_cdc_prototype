// 第五十二輪：疫情報導、職缺、採購、接種時程四個編輯頁「修改既有內容」也改成以現行版為底、只套用改過的欄位（docs/deploy.md §24）。
//
// 第五十一輪修好了 /admin/publish/?edit=（§22），這四個頁面各有自己的匯出函式，以前也是「表單重組一份完整 JSON」：
// 什麼都沒改就匯出，職缺與採購的 AI 白名單核准日變成今天、鍵順序全部重排；已下架的甄選名單整段被刪；
// 疫情報導的舊分類代號被換掉、圖檔替代文字被換成圖表的替代文字；接種時程整份重新排序，點過的那一筆鍵順序也變了，
// 畫面卻說「與目前上線版本相同」。
// 這裡先用模板產生的資料島（頁面拿到的就是這一份）在 Node 裡照頁面流程做一次，再用 Playwright 在真的頁面上驗一次。
import { govern, distBasePath, distEnv } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { sameValue } from '../src/client/admin/preprocess.js';
import { mergeFormEdit, changedFields, changedText } from '../src/client/admin/edit-merge.js';
import * as J from '../src/client/admin/jobs-edit-core.js';
import * as T from '../src/client/admin/tenders-edit-core.js';
import * as B from '../src/client/admin/bulletin-edit-core.js';
import * as V from '../src/client/admin/vaxschedule-edit-core.js';
import * as jobsTpl from '../src/templates/admin/jobs-edit.mjs';
import * as tendersTpl from '../src/templates/admin/tenders-edit.mjs';
import * as bulletinTpl from '../src/templates/admin/bulletin-edit.mjs';
import * as vaxTpl from '../src/templates/admin/vaccine-schedule.mjs';
import { makeSession, DEMO_ACCOUNTS } from '../src/client/admin/auth-rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = '2026-10-14';
const site = govern(TODAY);
const rawText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const fileOf = (item) => JSON.parse(rawText(item.__file));
const clone = (v) => JSON.parse(JSON.stringify(v));
const pretty = (o) => `${JSON.stringify(o, null, 2)}\n`;
/** 頁面拿到的資料島 */
function island(tpl, pagePath, id) {
  const h = String(tpl.render(makeCtx(site, 'zh-TW', { path: pagePath, alternates: ['zh-TW'], view: 'admin' })));
  const m = h.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
  assert.ok(m, `${pagePath} 沒有資料島 ${id}`);
  return { html: h, data: JSON.parse(m[1]) };
}
/** 兩份物件不同的頂層欄位（不看鍵順序） */
const diffKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !sameValue(a[k], b[k])).sort();
/** 現行版＋刻意更新的 reviewedAt（位置不變） */
const expectSaved = (file) => ({ ...file, reviewedAt: TODAY });

const JOBS = island(jobsTpl, '/admin/jobs/edit/', 'adm-jobs-data').data;
const TENDERS = island(tendersTpl, '/admin/tenders/edit/', 'adm-tenders-data').data;
const BULLETIN = island(bulletinTpl, '/admin/bulletin/edit/', 'adm-bulletin-data').data;
const VAX = island(vaxTpl, '/admin/vaccines/schedule/', 'adm-vxs-data').data;

/* ───────────────────────── 職缺 ───────────────────────── */
const jobLive = (id) => {
  const { stage, ...j } = JOBS.jobs.find((x) => x.id === id);
  void stage;
  return j;
};
/** 頁面的流程：帶入 → 記下 base →（改表單）→ 匯出 → 併回 */
function editJob(id, change = (st) => st) {
  const live = jobLive(id);
  const base = J.buildJob(J.stateFromJob(live), { today: TODAY, base: live });
  const out = J.buildJob(change(clone(J.stateFromJob(live))), { today: TODAY, base: live });
  const merged = mergeFormEdit(out, { ...live, sourceHash: JOBS.sourceHashes[id] }, base);
  return { live, base, out, merged, file: fileOf(site.byId.get(id)) };
}

test('職缺：資料島的職缺＝content 檔（只有已下架的甄選名單不在資料島裡）', () => {
  assert.equal(JOBS.jobs.length, site.collections.jobs.length);
  for (const j of site.collections.jobs) {
    const file = fileOf(j),
      live = jobLive(j.id);
    if (JOBS.resultTakenDown.includes(j.id)) {
      assert.deepEqual(
        diffKeys(file, live).filter((k) => !['result', 'waitlistUpdates'].includes(k)),
        [],
        j.id,
      );
      assert.deepEqual(
        Object.keys(live.result).sort(),
        ['publishedAt', 'refNo', 'unpublishAt'].filter((k) => k in file.result).sort(),
        '只剩公告日、下架日、字號',
      );
    } else assert.equal(pretty(live), pretty(file), j.id);
    assert.ok(JOBS.sourceHashes[j.id], `${j.id} 帶正本雜湊`);
  }
  assert.ok(JOBS.resultTakenDown.length >= 1, '測試前提：至少有一筆已下架、但檔案仍留著名單的職缺');
});

test('職缺：全部 11 筆不改就匯出，只差最後審閱日；已下架的名單是唯一的例外（畫面明說）', () => {
  let n = 0;
  for (const j of site.collections.jobs) {
    const { merged, file, live } = editJob(j.id);
    const expected = expectSaved(file);
    if (JOBS.resultTakenDown.includes(j.id)) {
      expected.result = live.result;
      if (!('waitlistUpdates' in live)) delete expected.waitlistUpdates;
    }
    assert.equal(pretty(merged), pretty(expected), j.id);
    assert.deepEqual(changedFields(merged, live), { fields: [], derived: ['reviewedAt'] }, j.id);
    n++;
  }
  assert.equal(n, 11);
  assert.match(changedText({ fields: [], derived: ['reviewedAt'] }), /^內容與現行版相同（另外匯出時會更新：最後審閱日）$/);
});

test('職缺：沒有合併時，表單重組的匯出會重排鍵順序（PR 看起來整檔都改了）——這就是要修的問題', () => {
  // 第五十二輪起 buildJob 本身也沿用既有的 aiWhitelist（核准日不再變成今天）；鍵順序仍是表單的順序，要靠合併保留
  const reordered = site.collections.jobs.filter((j) => {
    const { out, file } = editJob(j.id);
    assert.deepEqual(out.aiWhitelist, file.aiWhitelist, j.id);
    return JSON.stringify(Object.keys(out)) !== JSON.stringify(Object.keys(file));
  });
  assert.ok(reordered.length >= 5, `測試前提：多數職缺的鍵順序與表單不同（${reordered.length}）`);
});

test('職缺：只改一個欄位就只動那一欄（改到中文正文時，英譯另外標上舊版雜湊）', () => {
  const ID = 'job.2026-09-30-epidemic-physician'; // 英文已複核
  // 標題
  let r = editJob(ID, (st) => ({ ...st, title: `${st.title}（修訂）` }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['languages', 'reviewedAt', 'title']);
  assert.deepEqual(Object.keys(r.merged), Object.keys(r.file), '鍵順序不變');
  assert.equal(r.merged.languages.en.status, 'reviewed', '英文仍是已複核');
  assert.equal(r.merged.languages.en.sourceHash, JOBS.sourceHashes[ID], '標上舊版正本雜湊 ⇒ 建置顯示「中文已更新，譯文待複核」');
  assert.deepEqual(r.merged.i18n, r.file.i18n);
  assert.deepEqual(changedFields(r.merged, r.live).fields, ['languages', 'title']);
  // 資格條件改中間一行：順序照表單（不會被搬到最後）
  r = editJob(ID, (st) => {
    const q = st.qualifications.split('\n');
    q[1] = `${q[1]}（含）`;
    return { ...st, qualifications: q.join('\n') };
  });
  assert.deepEqual(diffKeys(r.file, r.merged), ['languages', 'qualifications', 'reviewedAt']);
  assert.equal(r.merged.qualifications[1], `${r.file.qualifications[1]}（含）`);
  assert.deepEqual(
    r.merged.qualifications.filter((_, i) => i !== 1),
    r.file.qualifications.filter((_, i) => i !== 1),
  );
  // 截止日（不是正文：英譯不動）
  r = editJob(ID, (st) => ({ ...st, deadlineAt: '2026-12-31' }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['deadlineAt', 'reviewedAt']);
  // 加一筆異動紀錄：既有紀錄原樣，新的接在後面
  r = editJob(ID, (st) => ({ ...st, amendments: [...st.amendments, { date: TODAY, kind: 'correction', text: '更正聯絡電話。' }] }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['amendments', 'reviewedAt']);
  assert.deepEqual(r.merged.amendments.slice(0, (r.file.amendments ?? []).length), r.file.amendments ?? []);
  assert.deepEqual(r.merged.amendments.at(-1), { date: TODAY, kind: 'correction', text: '更正聯絡電話。' });
  // 清空選填欄位＝移除那一欄
  const withUrl = site.collections.jobs.find((j) => j.applyUrl && !JOBS.resultTakenDown.includes(j.id));
  if (withUrl) {
    r = editJob(withUrl.id, (st) => ({ ...st, applyUrl: '' }));
    assert.deepEqual(diffKeys(r.file, r.merged), ['applyUrl', 'reviewedAt']);
    assert.ok(!('applyUrl' in r.merged));
  }
});

test('職缺：表單強制的預設值（權責單位、對象、審閱週期…）不會蓋掉現行版', () => {
  const ID = 'job.2026-09-24-research-assistant-epi';
  const live = { ...jobLive(ID), owner: 'unit.epidemic-intelligence', audience: ['public', 'professional'], reviewPeriodMonths: 3, keywords: ['甲', '乙'] };
  const base = J.buildJob(J.stateFromJob(live), { today: TODAY, base: live });
  const out = J.buildJob({ ...J.stateFromJob(live), summary: '新的摘要。' }, { today: TODAY, base: live });
  assert.equal(out.owner, 'unit.personnel', '測試前提：buildJob 會強制權責單位');
  const merged = mergeFormEdit(out, live, base);
  assert.deepEqual(diffKeys(live, merged), ['reviewedAt', 'summary']);
});

/* ───────────────────────── 採購 ───────────────────────── */
function editTender(id, change = (f) => f) {
  const live = TENDERS.tenders.find((x) => x.id === id);
  const formOf = (t) => ({
    ...t,
    scope: t.scope ?? [],
    specialTerms: t.specialTerms ?? [],
    attachments: T.attachmentsText(t.attachments ?? []),
    award: t.award ?? {},
    budgetNtd: t.budgetNtd ?? '',
  });
  const base = T.buildTender(formOf(live), { today: TODAY, base: live });
  const out = T.buildTender(change(formOf(clone(live))), { today: TODAY, base: live });
  const merged = mergeFormEdit(out, { ...live, sourceHash: TENDERS.sourceHashes[id] }, base);
  return { live, base, out, merged, file: fileOf(site.byId.get(id)) };
}

test('採購：資料島＝content 檔；全部 8 筆不改就匯出只差最後審閱日（鍵順序不變）', () => {
  assert.equal(TENDERS.tenders.length, 8);
  for (const live of TENDERS.tenders) {
    const file = fileOf(site.byId.get(live.id));
    assert.equal(pretty(live), pretty(file), live.id);
    const { merged, out } = editTender(live.id);
    assert.equal(pretty(merged), pretty(expectSaved(file)), live.id);
    assert.notDeepEqual(Object.keys(out), Object.keys(file), `${live.id}：沒有合併時鍵順序會重排（測試前提）`);
    assert.deepEqual(changedFields(merged, live).fields, []);
  }
});

test('採購：只改一個欄位就只動那一欄', () => {
  const ID = 'tender.2026-09-15-antiviral-115'; // 英文已複核
  let r = editTender(ID, (f) => ({ ...f, budgetNtd: String((f.budgetNtd || 0) + 1000) }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['budgetNtd', 'reviewedAt']);
  r = editTender(ID, (f) => ({ ...f, scope: [...f.scope.slice(0, 1), `${f.scope[1] ?? ''}（修訂）`, ...f.scope.slice(2)] }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['languages', 'reviewedAt', 'scope']);
  assert.equal(r.merged.languages.en.status, 'reviewed');
  assert.equal(r.merged.languages.en.sourceHash, TENDERS.sourceHashes[ID]);
  assert.deepEqual(Object.keys(r.merged), Object.keys(r.file));
  r = editTender(ID, (f) => ({ ...f, award: { date: TODAY, winner: '某某股份有限公司', amountNtd: '1000', note: '' } }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['award', 'reviewedAt']);
  assert.deepEqual(r.merged.award, { date: TODAY, winner: '某某股份有限公司', amountNtd: 1000 });
});

/* ───────────────────────── 疫情報導 ───────────────────────── */
const bLive = (id) => {
  const a = BULLETIN.articles.find((x) => x.id === id);
  return BULLETIN.legacyArticleTypes[id] ? { ...a, articleType: BULLETIN.legacyArticleTypes[id] } : a;
};
function editArticle(id, change = (st) => st, files = {}) {
  const a = BULLETIN.articles.find((x) => x.id === id);
  const live = bLive(id);
  const st0 = B.stateFromArticle(a, { categories: BULLETIN.categories });
  const issue = B.resolveIssue(st0, BULLETIN.issues, { today: TODAY });
  const base = B.buildArticle(st0, { today: TODAY, issue, base: a });
  const out = B.buildArticle(change(clone(st0)), { today: TODAY, issue, base: a, files });
  const merged = mergeFormEdit(out, { ...live, sourceHash: BULLETIN.sourceHashes[id] }, base);
  return { live, base, out, merged, file: fileOf(site.byId.get(id)) };
}

test('疫情報導：資料島＋舊分類代號＝content 檔；全部文章不改就匯出只差最後審閱日', () => {
  const ids = BULLETIN.articles.map((a) => a.id);
  assert.equal(ids.length, site.collections.articles.length);
  assert.ok(Object.keys(BULLETIN.legacyArticleTypes).length >= 1, '測試前提：有文章用舊分類代號（載入時被換成新代號）');
  for (const id of ids) {
    const file = fileOf(site.byId.get(id));
    assert.equal(pretty(bLive(id)), pretty(file), id);
    const { merged, out } = editArticle(id);
    assert.equal(pretty(merged), pretty(expectSaved(file)), id);
    assert.deepEqual(changedFields(merged, bLive(id)), { fields: [], derived: ['reviewedAt'] });
    if (BULLETIN.legacyArticleTypes[id]) assert.notEqual(out.articleType, file.articleType, '沒有合併時舊代號會被換掉（測試前提）');
  }
});

test('疫情報導：只改一個欄位就只動那一欄；圖的替代文字只動那張圖與它的附件宣告；新圖檔接在附件最後', () => {
  const ID = 'article.teb-42-19-1';
  let r = editArticle(ID, (st) => ({ ...st, title: `${st.title}（更正）` }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['reviewedAt', 'title']);
  assert.deepEqual(Object.keys(r.merged), Object.keys(r.file));
  r = editArticle(ID, (st) => ({ ...st, sections: st.sections.map((x, i) => (i === 1 ? { ...x, markdown: `${x.markdown}\n\n（補充）` } : x)) }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['reviewedAt', 'sections']);
  assert.deepEqual(
    r.merged.sections.filter((_, i) => i !== 1),
    r.file.sections.filter((_, i) => i !== 1),
  );
  // 參考文獻改一筆：順序照表單
  r = editArticle(ID, (st) => {
    const refs = st.references.split('\n');
    refs[0] = `${refs[0]} 更正`;
    return { ...st, references: refs.join('\n') };
  });
  assert.deepEqual(diffKeys(r.file, r.merged), ['references', 'reviewedAt']);
  assert.equal(r.merged.references[0], `${r.file.references[0]} 更正`);
  // 圖的替代文字：圖表與那張圖的附件宣告（設計上 assets 的 alt 取自圖表）；附件宣告的鍵順序與其他子欄位不變
  r = editArticle(ID, (st) => ({ ...st, figures: st.figures.map((f, i) => (i === 0 ? { ...f, alt: '新的替代文字' } : f)) }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['assets', 'figures', 'reviewedAt']);
  const fig = r.file.assets.find((x) => x.file === r.file.figures[0].file);
  const now = r.merged.assets.find((x) => x.file === fig.file);
  assert.deepEqual(Object.keys(now), Object.keys(fig));
  assert.deepEqual({ ...now, alt: fig.alt }, fig);
  assert.deepEqual(
    r.merged.assets.filter((x) => x.file !== fig.file),
    r.file.assets.filter((x) => x.file !== fig.file),
  );
  // 拖進一張新圖（圖 2）：附件多一筆在最後，其他原樣
  r = editArticle(
    ID,
    (st) => ({ ...st, figures: [...st.figures, { kind: 'figure', no: '2', caption: '新圖', markdown: '', alt: '新圖替代文字', file: 'fig-2.png' }] }),
    { 'fig-2.png': { kind: 'image', mime: 'image/png', bytes: 10, sha256: 'c'.repeat(64), width: 10, height: 10 } },
  );
  assert.deepEqual(diffKeys(r.file, r.merged), ['assets', 'figures', 'reviewedAt']);
  assert.deepEqual(r.merged.assets.slice(0, r.file.assets.length), r.file.assets);
  assert.equal(r.merged.assets.at(-1).file, 'fig-2.png');
  // 改分類：舊代號換成選的新代號
  r = editArticle('article.teb-42-13-1', (st) => ({ ...st, articleType: 'feature' }));
  assert.deepEqual(diffKeys(r.file, r.merged), ['articleType', 'reviewedAt']);
});

test('疫情報導分類主檔：沒改＝與 content 檔逐位元組相同；加一個分類＝只多一行（不再整檔重排）', () => {
  const raw = rawText('content/master/bulletin-categories.json');
  const C = BULLETIN.categories;
  assert.equal(B.categoriesJson(C, C), raw);
  const out = B.categoriesJson([...C, { key: 'case-report', label: '病例報告', labelEn: 'Case Report', order: 9 }], C);
  const a = raw.trimEnd().split('\n'),
    b = out.trimEnd().split('\n');
  assert.equal(b.length, a.length + 1);
  assert.deepEqual(b.slice(0, a.length - 2), a.slice(0, a.length - 2), '前面的分類一行都不變');
  assert.equal(b.at(-2), '  { "key": "case-report", "label": "病例報告", "labelEn": "Case Report", "order": 9 }');
  // 改一個分類的英文名：只有那一行變，表單沒有的鍵保留
  const C2 = C.map((c) => (c.key === 'feature' ? { ...c, labelEn: 'Features' } : c));
  const withExtra = C.map((c) => (c.key === 'feature' ? { ...c, color: 'teal' } : c));
  const out2 = B.categoriesJson(C2, withExtra).trimEnd().split('\n');
  assert.deepEqual(out2.filter((l, i) => l !== a[i]).length, 1);
  assert.match(
    out2.find((l) => l.includes('"feature"')),
    /"labelEn": "Features".*"color": "teal"/,
  );
});

/* ───────────────────────── 接種時程 ───────────────────────── */
test('接種時程：不改、或每一筆都經過表單來回，匯出都與 content 檔逐位元組相同（順序、鍵順序都不變）', () => {
  const raw = rawText('content/master/immunization-schedule.json');
  const live = VAX.items;
  assert.equal(pretty(live), raw, '資料島＝content 檔');
  assert.equal(
    pretty(
      V.mergeSchedule(
        live.map((i) => ({ ...i })),
        live,
      ),
    ),
    raw,
  );
  const roundTrip = live.map((i) => V.buildItem(V.stateFromItem(i)));
  assert.ok(
    roundTrip.some((x, k) => JSON.stringify(x) !== JSON.stringify(live[k])),
    '測試前提：表單來回會改鍵順序',
  );
  assert.equal(pretty(V.mergeSchedule(roundTrip, live)), raw);
  assert.notEqual(
    pretty(
      V.sortedForExport(
        live,
        VAX.vaccines.map((v) => v.id),
      ),
    ),
    raw,
    '以前的匯出（重新排序）與原檔不同',
  );
  assert.equal(V.diffSummary(live, V.mergeSchedule(roundTrip, live)).dirty, false);
});

test('接種時程：改一筆的一個欄位只動那一欄；新增插在前一筆後面；刪除只少那一筆；載入後 main 上別人改的筆不被蓋回', () => {
  const live = VAX.items;
  const k = live.findIndex((i) => i.hardLimitMonths != null); // 表單來回會改鍵順序的那種
  assert.ok(k >= 0);
  const items = live.map((i) => ({ ...i }));
  items[k] = V.buildItem({ ...V.stateFromItem(live[k]), note: '新的備註' });
  let out = V.mergeSchedule(items, live);
  assert.deepEqual(
    out.map((i) => i.id),
    live.map((i) => i.id),
  );
  out.forEach((it, j) => {
    if (j !== k) assert.equal(JSON.stringify(it), JSON.stringify(live[j]));
  });
  assert.deepEqual(diffKeys(live[k], out[k]), ['note']);
  assert.equal(out[k].note, '新的備註');
  assert.deepEqual(
    Object.keys(out[k]).filter((x) => x in live[k]),
    Object.keys(live[k]),
    '鍵順序不變',
  );
  assert.deepEqual(V.diffSummary(live, out), { added: [], removed: [], changed: [live[k].id], dirty: true });
  // 新增（插在第 3 筆後面）與刪除（第 0 筆）
  const added = { ...live[3], id: 'sched.test-new', label: '新項目' };
  const items2 = live.map((i) => ({ ...i }));
  items2.splice(4, 0, added);
  items2.splice(0, 1);
  out = V.mergeSchedule(items2, live);
  assert.deepEqual(
    out.map((i) => i.id),
    [...live.slice(1, 4).map((i) => i.id), 'sched.test-new', ...live.slice(4).map((i) => i.id)],
  );
  // 草稿開始之後 main 上別人改了第 5 筆、又加了一筆：草稿只改第 6 筆，兩邊都保留
  const orig = live;
  const main = live.map((i, j) => (j === 5 ? { ...i, note: '別人改的' } : i)).concat([{ ...live[0], id: 'sched.someone-else' }]);
  const mine = orig.map((i) => ({ ...i }));
  mine[6] = V.buildItem({ ...V.stateFromItem(orig[6]), ageLabel: '我改的' });
  out = V.mergeSchedule(mine, main, orig);
  assert.equal(out[5].note, '別人改的');
  assert.equal(out[6].ageLabel, '我改的');
  assert.equal(out.at(-1).id, 'sched.someone-else');
});

/* ───────────────────────── 頁面接線 ───────────────────────── */
test('四個編輯頁都用以現行版為底的匯出，並顯示「目前改動的欄位」', () => {
  const src = (f) => rawText(`src/client/admin/${f}`);
  assert.match(src('jobs-edit.js'), /mergeFormEdit\(out, liveOf\(base\), editBase\)/);
  assert.match(src('jobs-edit.js'), /editBase = base \? rawJob\(\) : null/);
  assert.match(src('tenders-edit.js'), /mergeFormEdit\(out, liveOf\(base\), editBase\)/);
  assert.match(src('bulletin-edit.js'), /mergeFormEdit\(out, live, editBase\)/);
  assert.match(src('vaxschedule-edit.js'), /mergeSchedule\(items, D\.items, orig\)/);
  assert.doesNotMatch(src('vaxschedule-edit.js'), /JSON\.stringify\(sortedForExport/);
  for (const [tpl, p, id] of [
    [jobsTpl, '/admin/jobs/edit/', 'jf-changed'],
    [tendersTpl, '/admin/tenders/edit/', 'tf-changed'],
  ])
    assert.ok(island(tpl, p, p.includes('jobs') ? 'adm-jobs-data' : 'adm-tenders-data').html.includes(`id="${id}"`), id);
});

// ───────────────────────── 端到端（Playwright）：真的頁面 ─────────────────────────
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

test('端到端：四個編輯頁開啟每一筆既有內容、不改就匯出，與 content 檔只差最後審閱日；改一個欄位只動那一欄', { timeout: 240000 }, async (t) => {
  const js = path.join(DIST, 'assets/js/admin/edit-merge.js');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) return t.skip('dist 尚未建置');
  if (!fs.existsSync(js)) return t.skip('dist 是舊版（請重新建置）');
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return t.skip('沒有 Playwright');
  }
  if (!fs.existsSync(CHROME)) return t.skip('沒有 Chromium');
  const today = JSON.parse(
    /id="adm-jobs-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(DIST, 'admin/jobs/edit/index.html'), 'utf8'))?.[1] ?? '{}',
  ).today;
  if (today !== TODAY) return t.skip(`dist 的建置日是 ${today}（請用 BUILD_TODAY=${TODAY} 建置）`);
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.mjs'), String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: distEnv(DIST, { GATEWAY: 'off' }),
  });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const errors = [];
  const base = `http://localhost:${port}${distBasePath(DIST)}`;
  try {
    for (let i = 0; i < 80; i++) {
      try {
        if ((await fetch(`${base}/`)).ok) break;
      } catch {
        /* 等伺服器 */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    await ctx.addInitScript(
      ({ s }) => {
        try {
          if (!localStorage.getItem('cdc.admin.session')) localStorage.setItem('cdc.admin.session', JSON.stringify(s));
        } catch {
          /* sandbox iframe */
        }
      },
      { s: makeSession(DEMO_ACCOUNTS.find((a) => a.sub === 'demo-001')) },
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|Blocked script execution in 'about:srcdoc'/.test(m.text())) errors.push(m.text());
    });
    const outOf = async (sel) => JSON.parse(await page.textContent(sel));
    const waitOut = (sel) => page.waitForFunction((s) => /^[[{]/.test(document.querySelector(s)?.textContent ?? ''), sel);

    // ① 職缺：全部
    for (const j of site.collections.jobs) {
      await page.goto(`${base}/admin/jobs/edit/?id=${j.id}&gateway=off`);
      await waitOut('#jf-out');
      const out = await outOf('#jf-out');
      const expected = expectSaved(fileOf(j));
      if (JOBS.resultTakenDown.includes(j.id)) {
        const live = jobLive(j.id);
        expected.result = live.result;
        if (!('waitlistUpdates' in live)) delete expected.waitlistUpdates;
      }
      assert.equal(pretty(out), pretty(expected), `${j.id}：只差最後審閱日（已下架的名單除外），其他一個位元組都不變`);
      assert.equal(await page.getAttribute('#jf-changed', 'data-changed'), '', j.id);
      assert.match(await page.textContent('#jf-changed'), /內容與現行版相同（另外匯出時會更新：最後審閱日）/);
      if (JOBS.resultTakenDown.includes(j.id)) assert.match(await page.textContent('#jf-changed'), /下架.*不含正取、備取與遞補名單/);
    }
    await page.goto(`${base}/admin/jobs/edit/?id=job.2026-09-30-epidemic-physician&gateway=off`);
    await waitOut('#jf-out');
    const jf = fileOf(site.byId.get('job.2026-09-30-epidemic-physician'));
    await page.fill('#jf-title', `${jf.title}（修訂）`);
    await page.waitForFunction(() => document.querySelector('#jf-changed')?.dataset.changed);
    assert.deepEqual((await page.getAttribute('#jf-changed', 'data-changed')).split(' '), ['languages', 'title']);
    assert.deepEqual(diffKeys(jf, await outOf('#jf-out')), ['languages', 'reviewedAt', 'title']);

    // ② 採購：全部
    for (const x of site.collections.tenders) {
      await page.goto(`${base}/admin/tenders/edit/?id=${x.id}&gateway=off`);
      await waitOut('#tf-out');
      const file = fileOf(x);
      assert.equal(pretty(await outOf('#tf-out')), pretty(expectSaved(file)), x.id);
      assert.match(await page.textContent('#tf-changed'), /內容與現行版相同/);
    }
    await page.goto(`${base}/admin/tenders/edit/?id=tender.2026-09-15-antiviral-115&gateway=off`);
    await waitOut('#tf-out');
    const tfile = fileOf(site.byId.get('tender.2026-09-15-antiviral-115'));
    await page.fill('#tf-budget', String(tfile.budgetNtd + 1000));
    await page.waitForFunction(() => document.querySelector('#tf-changed')?.dataset.changed === 'budgetNtd');
    assert.deepEqual(diffKeys(tfile, await outOf('#tf-out')), ['budgetNtd', 'reviewedAt']);

    // ③ 疫情報導：全部
    for (const a of site.collections.articles) {
      await page.goto(`${base}/admin/bulletin/edit/?edit=${a.id}&gateway=off`);
      await waitOut('#te-out');
      const file = fileOf(a);
      assert.equal(pretty(await outOf('#te-out')), pretty(expectSaved(file)), a.id);
      assert.match(await page.textContent('#te-changed'), /內容與現行版相同/);
    }
    await page.goto(`${base}/admin/bulletin/edit/?edit=article.teb-42-13-1&gateway=off`);
    await waitOut('#te-out');
    const afile = fileOf(site.byId.get('article.teb-42-13-1'));
    await page.fill('#te-title', `${afile.title}（更正）`);
    await page.waitForFunction(() => document.querySelector('#te-changed')?.dataset.changed === 'title');
    assert.deepEqual(diffKeys(afile, await outOf('#te-out')), ['reviewedAt', 'title']);
    assert.equal((await outOf('#te-out')).articleType, afile.articleType, '舊分類代號原樣');

    // ④ 接種時程：載入、逐筆點過，都與原檔逐位元組相同；改一筆的項目名稱只動那一筆的那一欄
    const vraw = rawText('content/master/immunization-schedule.json');
    await page.goto(`${base}/admin/vaccines/schedule/?gateway=off`);
    await waitOut('#vx-out');
    assert.equal(`${await page.textContent('#vx-out')}\n`, vraw);
    const n = VAX.items.length;
    for (let i = 0; i < n; i++) await page.click(`#vx-list [data-idx="${i}"]`);
    await page.click('#vx-list [data-idx="0"]');
    assert.equal(`${await page.textContent('#vx-out')}\n`, vraw, '逐筆點過（每一筆都經過表單來回）仍與原檔相同');
    assert.match(await page.textContent('#vx-diff'), /與目前上線版本相同/);
    const k = VAX.items.findIndex((i) => i.hardLimitMonths != null);
    await page.click(`#vx-list [data-idx="${k}"]`);
    await page.fill('#vx-label', `${VAX.items[k].label}（修訂）`);
    await page.waitForFunction(() => /修改 1/.test(document.querySelector('#vx-diff')?.textContent ?? ''));
    const vout = await outOf('#vx-out');
    assert.deepEqual(
      vout.map((i) => i.id),
      VAX.items.map((i) => i.id),
    );
    vout.forEach((it, j) => {
      if (j !== k) assert.equal(JSON.stringify(it), JSON.stringify(VAX.items[j]));
    });
    assert.deepEqual(diffKeys(VAX.items[k], vout[k]), ['label']);
    assert.deepEqual(Object.keys(vout[k]), Object.keys(VAX.items[k]));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.kill();
  }
});
