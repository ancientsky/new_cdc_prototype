// 第四十四輪：署長、副署長簡介（/about/leadership/、各首長頁）。
// (1) 內容與 schema：profile 只允許公務欄位、網址以職位命名、verification:pending 並列來源；
// (2) 渲染：總覽頁卡片、首長頁（職稱、姓名、照片占位、學經歷段落、其他首長）、關於頁區塊、頁尾連結、.md 與 JSON-LD；
// (3) 個資掃描：首長簡介檔只放行 profile.name，其他姓名、手機、信箱照擋，私人欄位詞（出生、住址…）另擋；非簡介檔的姓名規則不變；
// (4) 後台：page 型別可從「同事修改這頁」載入並匯出，profile 與 verification 原樣保留、私人欄位詞預檢。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { govern } from './helpers.mjs';
import { ROOT } from '../scripts/lib/load.mjs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import { layout } from '../src/templates/layout.mjs';
import * as page from '../src/templates/public/page.mjs';
import * as about from '../src/templates/public/about.mjs';
import { scanPaths, officialProfileNames, PROFILE_PRIVATE, KIND_LABEL } from '../scripts/lib/pii-scan.mjs';
import * as P from '../src/client/admin/preprocess.js';
import { STRINGS } from '../src/client/i18n.js';

const str = (r) => String(r);
const site = govern('2026-10-13');
const ctxOf = (lang = 'zh-TW', p = '/about/leadership/') => makeCtx(site, lang, { path: p, alternates: ['zh-TW', 'en'] });
const IDS = ['page.leadership-director-general', 'page.leadership-deputy-director-general-1', 'page.leadership-deputy-director-general-2'];
const DG = site.byId.get('page.leadership-director-general');

/* ───────── (1) 內容與 schema ───────── */
test('首長簡介：總覽頁＋署長＋兩位副署長，權責秘書室、網址以職位命名、profile 只有公務欄位、verification:pending 並列來源', () => {
  const idx = page.leadershipIndex(site);
  assert.equal(idx?.id, 'page.leadership');
  assert.equal(page.standalonePath(idx), '/about/leadership/');
  const list = page.leadershipProfiles(site);
  assert.deepEqual(list.map((p) => p.id), IDS, '依 profile.order 排序：署長、副署長 1、副署長 2');
  for (const p of list) {
    assert.equal(p.owner, 'unit.secretariat', `${p.id} 權責秘書室`);
    assert.match(page.standalonePath(p), /^\/about\/leadership\/(director-general|deputy-director-general-\d)\/$/, '網址用職位不用人名');
    assert.equal(p.verification?.status, 'pending', `${p.id} 原型依公開資料整理，一律待確認`);
    assert.ok(p.verification.pendingItems?.length && p.verification.sources?.length, `${p.id} 待確認事項與來源`);
    assert.ok(p.verification.sources.some((s) => s.url.startsWith('https://www.cdc.gov.tw/') && s.official === true), `${p.id} 至少一個官網來源`);
    assert.ok(p.verification.sources.every((s) => s.verified === false), '開發環境連不到 cdc.gov.tw，不得宣稱已逐字核對');
    assert.ok(/## 學歷/.test(p.bodyMarkdown) && /## 經歷/.test(p.bodyMarkdown) && /## 專長/.test(p.bodyMarkdown), `${p.id} 四段式內文`);
    for (const w of PROFILE_PRIVATE) assert.ok(!JSON.stringify(p).includes(w), `${p.id} 不得含私人欄位詞「${w}」`);
    assert.ok(p.gov?.unverified, '治理：unverified 註記');
  }
  assert.equal(DG.profile.termNo, 6); assert.equal(DG.profile.since, '2025-09'); assert.equal(DG.profile.nameEn, 'Lo, Yi-Chun');
});

test('schema：profile 不接受私人欄位（additionalProperties:false）、role 只有三種、photo 只能在 /img/ 或 /files/', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const f of ['_common.json', 'page.json']) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', f), 'utf8')));
  const validate = ajv.getSchema('https://cdc-prototype/schemas/page.json');
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/pages/leadership-director-general.json'), 'utf8'));
  assert.ok(validate(base), JSON.stringify(validate.errors));
  const bad = (patch) => { const j = structuredClone(base); Object.assign(j.profile, patch); return !validate(j); };
  assert.ok(bad({ birthDate: '1977-01-01' }), '出生日期欄位要被擋');
  assert.ok(bad({ homeAddress: 'x' }));
  assert.ok(bad({ role: 'minister' }));
  assert.ok(bad({ photo: 'https://example.com/a.jpg' }), '照片只能是站內 /img/ 或 /files/');
  assert.ok(bad({ since: '2025/09' }));
});

/* ───────── (2) 渲染 ───────── */
test('首長頁：職稱列、姓名、英文名、就任、占位照片＋「照片待提供」、學經歷段落、其他首長、ProfilePage JSON-LD；英文頁用英文職稱', () => {
  const ctx = ctxOf('zh-TW', '/about/leadership/director-general/');
  const html = str(page.render(ctx, { item: DG }));
  assert.match(html, /<p class="c-profile__role">第 6 任署長<\/p>/);
  assert.match(html, /<h1 class="c-profile__name">羅一鈞<\/h1>/);
  assert.match(html, /lang="en">Lo, Yi-Chun · Director-General</);
  assert.match(html, /就任 <time datetime="2025-09">2025-09<\/time>/);
  assert.match(html, /\/img\/leadership\/placeholder\.svg/); assert.ok(!/\/zh-TW\/img\//.test(html));
  assert.match(html, /照片待秘書室提供/);
  assert.match(html, /<h2[^>]*>學歷<\/h2>/); assert.match(html, /國立臺灣大學醫學系/);
  assert.match(html, /內容待權責單位確認/, '頁首 unverified 警示');
  assert.match(html, /id="h-others"/); assert.match(html, /曾淑慧/); assert.match(html, /林明誠/);
  assert.match(html, /只刊登與公務職位有關的公開資訊/);
  assert.match(html, /FBu4BEKk3d-PY0QD25swbQ/, '連到現行官網署長簡介');
  const m = page.meta(ctx, { item: DG });
  assert.equal(m.title, '第 6 任署長 羅一鈞');
  const ld = m.jsonLd.find((x) => x['@type'] === 'ProfilePage');
  assert.equal(ld.mainEntity.name, '羅一鈞'); assert.equal(ld.mainEntity.jobTitle, '署長');
  const en = str(page.render(ctxOf('en', '/about/leadership/director-general/'), { item: DG }));
  assert.match(en, /Director-General \(6th\)/); assert.match(en, /<h1 class="c-profile__name">Lo, Yi-Chun<\/h1>/); assert.match(en, /Infectious Diseases Fellow/);
  const md = page.markdown(ctx, { item: DG });
  assert.match(md, /\*\*第 6 任署長　羅一鈞\*\*（Lo, Yi-Chun） · 就任 2025-09/); assert.match(md, /## 經歷/);
});

test('總覽頁與關於頁：三張卡片（照片、職稱、姓名、待確認徽章）、關於頁多了首長簡介區塊；頁尾「關於」群組有首長簡介，外語連英文版', () => {
  const idx = page.leadershipIndex(site);
  const html = str(page.render(ctxOf(), { item: idx }));
  assert.equal((html.match(/class="c-profile-card c-profile-card--placeholder"/g) ?? []).length, 3);
  assert.match(html, /c-profile-card__role">第 6 任署長<\/span><h3 class="c-profile-card__name">羅一鈞<\/h3>/);
  assert.match(html, /href="[^"]*\/about\/leadership\/deputy-director-general-2\/"/);
  assert.equal((html.match(/內容待確認/g) ?? []).length, 3);
  const ab = str(about.render(ctxOf('zh-TW', '/about/')));
  assert.match(ab, /id="h-leadership">首長簡介<\/h2>/);
  assert.match(ab, /c-profile-card__name">林明誠/);
  assert.match(ab, /id="h-director">署長職掌與施政重點<\/h2>/, '原有職掌頁保留');
  const lay = (lang) => str(layout(makeCtx(site, lang, { path: '/', alternates: ['zh-TW', 'en', 'vi'] }), { title: 't', body: '<p>x</p>', item: null }));
  assert.match(lay('zh-TW'), /href="[^"]*\/about\/leadership\/">首長簡介<\/a>/);
  assert.match(lay('en'), /href="[^"]*\/en\/about\/leadership\/">Leadership<\/a>/);
  assert.match(lay('vi'), /href="[^"]*\/en\/about\/leadership\/" hreflang="en">Lãnh đạo<\/a>/, '沒有越南文頁就連英文版');
  for (const k of ['profile.since', 'profile.scope', 'footer.leadership', 'about.s.leadership']) assert.ok(STRINGS['zh-TW'][k] && STRINGS.en[k], k);
  assert.ok(page.pages(site).some((p) => p.path === '/about/leadership/director-general/' && p.lang === 'en'));
  assert.ok(!page.pages(site).some((p) => p.path === '/about/leadership/director-general/' && p.lang === 'vi'), '沒有越南文版就不出頁');
});

/* ───────── (3) 個資掃描 ───────── */
test('個資掃描：首長簡介檔只放行 profile.name；別人的姓名、手機、信箱照擋；私人欄位詞另擋；同一姓名出現在非簡介檔仍擋', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-prof-'));
  fs.mkdirSync(path.join(dir, 'content/pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'content/news'), { recursive: true });
  const prof = { id: 'page.x', type: 'page', slug: 'about/leadership/director-general', profile: { role: 'director-general', roleTitle: '署長', name: '王小明' }, bodyMarkdown: '姓名：王小明\n## 經歷\n- 署長' };
  fs.writeFileSync(path.join(dir, 'content/pages/x.json'), JSON.stringify(prof));
  assert.deepEqual(scanPaths(dir).hits, [], '簡介檔裡自己的姓名放行');
  assert.deepEqual([...officialProfileNames(prof)], ['王小明']);
  assert.equal(officialProfileNames({ type: 'news', profile: { name: '王小明' } }), null, '只有 page 型別算簡介檔');
  // 別人的姓名、手機、信箱、私人欄位詞
  fs.writeFileSync(path.join(dir, 'content/pages/x.json'), JSON.stringify({ ...prof, bodyMarkdown: '姓名：王小明\n申請人：林大華\n手機 0912-345-678\n信箱 a.b@gmail.com\n出生：1970 年\n住址：臺北市' }));
  const r = scanPaths(dir);
  const kinds = r.hits.map((h) => h.kind).sort();
  assert.deepEqual(kinds, ['email', 'mobile', 'person-name', 'profile-private', 'profile-private', 'profile-private'].sort(), r.hits.map((h) => `${h.kind}:${h.masked}`).join(' '));
  assert.ok(r.hits.some((h) => h.kind === 'person-name' && h.masked === '林＊＊'));
  assert.ok(r.hits.some((h) => h.kind === 'profile-private' && h.masked === '「出生」'));
  assert.equal(KIND_LABEL['profile-private'], '首長簡介不得刊登的私人資料');
  // 同一個姓名寫在新聞稿裡（非簡介檔）：規則不變，照擋
  fs.writeFileSync(path.join(dir, 'content/pages/x.json'), JSON.stringify(prof));
  fs.writeFileSync(path.join(dir, 'content/news/n.json'), JSON.stringify({ id: 'news.n', type: 'news', bodyMarkdown: '錄取：王小明' }));
  assert.ok(scanPaths(dir).hits.some((h) => h.file === 'content/news/n.json' && h.kind === 'person-name'));
  // 「出生」出現在非簡介檔不算 profile-private（那條只對簡介檔生效）
  fs.writeFileSync(path.join(dir, 'content/news/n.json'), JSON.stringify({ id: 'news.n', type: 'news', bodyMarkdown: '出生率統計' }));
  assert.deepEqual(scanPaths(dir).hits, []);
  fs.rmSync(dir, { recursive: true, force: true });
  // 真實內容：三個首長檔與全庫都過
  assert.deepEqual(scanPaths(ROOT, ['content/pages']).hits, []);
});

/* ───────── (4) 後台 ───────── */
test('後台：page 型別進 TYPES／DIRS／collectionOfId；itemToForm → toContent 來回保留 slug、profile、verification；私人欄位詞與 slug 預檢', () => {
  assert.ok(P.TYPES.some((t) => t.value === 'page'));
  assert.equal(P.DIRS.page, 'pages'); assert.equal(P.collectionOfId('page.leadership-director-general'), 'pages');
  const f = P.itemToForm(DG);
  assert.equal(f.type, 'page'); assert.equal(f.extra.pageSlug, 'about/leadership/director-general'); assert.equal(f.extra.profileName, '羅一鈞'); assert.equal(f.extra.profileTermNo, '6');
  const out = P.buildExport({
    type: f.type, id: f.id, title: f.title, body: f.body, owner: f.owner, steward: DG.steward, reviewPeriodMonths: f.period, audience: f.audience, tasks: f.tasks, basedOn: f.basedOn, langs: f.langs,
    summary: DG.summary, keywords: DG.keywords, today: '2026-10-13', extra: f.extra,
  });
  {
    const merged = P.mergeEdit(out, DG, out); // 第五十一輪：第三個參數是表單剛帶入時的匯出（這裡沒改，所以就是 out）
    assert.equal(out.slug, 'about/leadership/director-general'); assert.equal(out.profile.role, 'director-general'); assert.equal(out.profile.roleTitleEn, 'Director-General');
    assert.equal(merged.slug, 'about/leadership/director-general');
    assert.equal(merged.profile.name, '羅一鈞'); assert.equal(merged.profile.termNo, 6); assert.equal(merged.profile.photoAlt, '署長羅一鈞', '表單沒有的簡介欄位原樣保留');
    assert.equal(merged.verification?.status, 'pending', '改內文不會讓待確認狀態消失');
    assert.equal(merged.publishedAt, DG.publishedAt);
    assert.deepEqual(P.requiredCheck(merged, ['unit.secretariat']), []);
  }
  const bad = { type: 'page', slug: 'leaders/x', profile: { role: 'director-general', roleTitle: '署長', name: '王小明' }, bodyMarkdown: '出生於臺北' };
  const probs = P.profileProblems(bad);
  assert.ok(probs.some((m) => m.includes('出生'))); assert.ok(probs.some((m) => m.includes('about/leadership/')));
  assert.deepEqual(P.PROFILE_ROLE_TITLE['deputy-director-general'], ['副署長', 'Deputy Director-General']);
});

test('dist 若已建置：首長頁、總覽頁、英文版、.md 與 v1/pages.json 實際輸出', { skip: !fs.existsSync(path.join(ROOT, 'dist/about/leadership/index.html')) }, () => {
  const d = (p) => fs.readFileSync(path.join(ROOT, 'dist', p), 'utf8');
  assert.match(d('about/leadership/index.html'), /羅一鈞/);
  assert.match(d('about/leadership/director-general/index.html'), /第 6 任署長/);
  assert.match(d('en/about/leadership/director-general/index.html'), /Director-General \(6th\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/about/leadership/director-general.md')));
  const api = JSON.parse(d('v1/pages.json'));
  const dg = api.data.find((x) => x.id === 'page.leadership-director-general');
  assert.equal(dg.profile.name, '羅一鈞'); assert.equal(dg.path, '/about/leadership/director-general/');
});
