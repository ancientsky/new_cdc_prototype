// 第四十九輪：外語頁中文夾雜的結構性修正。
// 不需要先 build：模板直接渲染、純函式直接呼叫。
// 範圍：清單／導覽頁（網站導覽、申請服務、關於）、二級內容的機器初稿（services／news／media／pages／datasets）、檢驗用語對照（lab-terms）、授權名稱、STRICT_CJK_PAGES。
import test from 'node:test';
import assert from 'node:assert/strict';
import { govern } from './helpers.mjs';
import { makeCtx, langAvailable } from '../scripts/lib/pages.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { cjkStats, isStrictCjkPage, STRICT_CJK_PAGES } from '../scripts/lib/i18n-quality.mjs';
import { licenseLabel } from '../src/templates/public/_partials.mjs';
import { listTarget, splitByLang, reviewedText, badgeKind, pick, zhText } from '../src/templates/public/_listing.mjs';
import * as sitemapPage from '../src/templates/public/sitemap-page.mjs';
import * as apply from '../src/templates/public/apply.mjs';
import * as about from '../src/templates/public/about.mjs';
import * as lab from '../src/templates/public/lab.mjs';
import { STRINGS, t } from '../src/client/i18n.js';

const site = govern('2026-10-14');
const FOREIGN = ['en', 'tl', 'vi', 'id', 'th'];
const ALL = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const ctxOf = (lang, p = '/') => makeCtx(site, lang, { path: p, alternates: ALL });
const str = (x) => String(x);

test('清單頁：網站導覽與申請服務總覽在五個外語都壓到 5% 以下（含結構性標示，不靠內容翻譯進度）', () => {
  for (const lang of FOREIGN) {
    for (const [name, mod, p] of [['sitemap-page', sitemapPage, '/sitemap-page/'], ['apply', apply, '/apply/']]) {
      const html = str(mod.render(ctxOf(lang, p)));
      const s = cjkStats(html);
      assert.ok(s.ratio < 0.05, `${lang} ${name} 中文比例 ${(s.ratio * 100).toFixed(1)}%`);
    }
  }
});

test('關於頁（about）在五個外語都低於 5%', () => {
  for (const lang of FOREIGN) {
    const s = cjkStats(str(about.render(ctxOf(lang, '/about/'))));
    assert.ok(s.ratio < 0.05, `${lang} about ${(s.ratio * 100).toFixed(1)}%`);
  }
});

test('網站導覽：中文獨有的項目收進標示過的摺疊區；摺疊區內是 lang="zh-TW"，而且 zh-TW 頁沒有這個區塊', () => {
  const en = str(sitemapPage.render(ctxOf('en', '/sitemap-page/')));
  assert.match(en, /c-sitemap__zh/);
  assert.match(en, /Pages available in Chinese only \(\d+\)/);
  assert.match(en, /<ul[^>]*lang="zh-TW"/);
  const zh = str(sitemapPage.render(ctxOf('zh-TW', '/sitemap-page/')));
  assert.doesNotMatch(zh, /c-sitemap__zh/);
});

test('申請服務總覽：中文獨有者帶「僅有中文」標記；英文有機器初稿者顯示英文標題並標「機器翻譯」', () => {
  const svc = site.collections.services.find((s) => s.id === 'service.vaccine-injury-compensation' || /vaccine-injury-compensation/.test(s.id));
  assert.ok(svc?.i18n?.en?.title, '預防接種受害救濟申請要有英文初稿');
  assert.equal(svc.i18n.en.machineTranslated, true);
  assert.notEqual(svc.languages.en.status, 'reviewed', '機器初稿不能被標成 reviewed');
  const html = str(apply.render(ctxOf('en', '/apply/')));
  assert.ok(html.includes(svc.i18n.en.title));
});

test('listTarget：頁面語言有版本 → 頁面語言；沒有但英文有 → 英文（hreflang=en）；都沒有 → 中文正本', () => {
  const ctxTh = ctxOf('th');
  const mk = (extra) => ({ id: 'x.1', type: 'service', slug: 'x1', title: '某服務', languages: { 'zh-TW': { status: 'source' } }, ...extra });
  const onlyZh = mk({});
  const t1 = listTarget(ctxTh, onlyZh);
  assert.equal(t1.hreflang, 'zh-TW');
  const withEn = mk({ languages: { 'zh-TW': { status: 'source' }, en: { status: 'reviewed' } }, i18n: { en: { title: 'A service' } } });
  const t2 = listTarget(ctxTh, withEn);
  assert.equal(t2.hreflang, 'en');
  const withTh = mk({ languages: { 'zh-TW': { status: 'source' }, en: { status: 'reviewed' }, th: { status: 'reviewed' } }, i18n: { en: { title: 'A service' }, th: { title: 'บริการ' } } });
  assert.equal(listTarget(ctxTh, withTh).hreflang, null);
});

test('splitByLang：zh-TW 頁全部是原生；外語頁依 zhOnly 分兩堆', () => {
  const entries = [{ r: { zhOnly: false } }, { r: { zhOnly: true } }, { r: { zhOnly: true } }];
  assert.deepEqual(splitByLang(ctxOf('zh-TW'), entries).zhOnly, []);
  const s = splitByLang(ctxOf('en'), entries);
  assert.equal(s.native.length, 1);
  assert.equal(s.zhOnly.length, 2);
});

test('reviewedText：一級內容只認 reviewed 的譯文，機器初稿不上線', () => {
  const ctx = ctxOf('en');
  const item = {
    title: '澄清標題', sourceLang: 'zh-TW',
    languages: { 'zh-TW': { status: 'source' }, en: { status: 'machine' } },
    i18n: { en: { title: 'Machine draft', machineTranslated: true } },
  };
  const r = reviewedText(ctx, item, 'title');
  assert.equal(r.text, '澄清標題');
  assert.equal(r.zhOnly, true);
  item.languages.en.status = 'reviewed';
  assert.equal(reviewedText(ctx, item, 'title').text, 'Machine draft');
  assert.equal(reviewedText(ctxOf('zh-TW'), item, 'title').text, '澄清標題');
});

test('badgeKind：reviewed 但顯示的欄位列在 machineFields → 仍標機器；其餘 reviewed', () => {
  const item = { languages: { en: { status: 'reviewed' } }, i18n: { en: { machineFields: ['bodyMarkdown'] } } };
  assert.equal(badgeKind(item, 'en', ['bodyMarkdown']), 'machine');
  assert.equal(badgeKind(item, 'en', ['title']), 'reviewed');
  assert.equal(badgeKind({ languages: { en: { status: 'machine' } } }, 'en', ['title']), 'machine');
  assert.equal(badgeKind({ languages: {} }, 'en', []), 'machine');
});

test('pick／zhText：外語頁沒有譯文的中文片段包 lang="zh-TW"，zh-TW 頁原樣', () => {
  assert.match(str(zhText(ctxOf('en'), '中文')), /<span lang="zh-TW">中文<\/span>/);
  assert.equal(zhText(ctxOf('zh-TW'), '中文'), '中文');
  assert.equal(zhText(ctxOf('en'), ''), '');
  const r = pick(ctxOf('en'), { title: '標題', languages: {}, i18n: { en: { title: 'Title' } } }, 'title');
  assert.equal(r.text, 'Title');
});

test('機器初稿標記：本輪新增的 i18n 文字都有 machineTranslated，且 status 不是 reviewed（除非有 machineFields 逐欄標示）', () => {
  let n = 0;
  for (const col of ['services', 'news', 'media', 'pages', 'datasets']) {
    for (const it of site.collections[col] ?? []) {
      for (const [lang, v] of Object.entries(it.i18n ?? {})) {
        if (!v.machineTranslated && !v.machineFields) continue;
        n++;
        const st = it.languages?.[lang]?.status;
        if (st === 'reviewed') assert.ok(v.machineFields?.length || v.machineTranslated, `${it.id} ${lang}`);
        assert.ok(v.machineTranslatedAt, `${it.id} ${lang} 缺 machineTranslatedAt`);
      }
    }
  }
  assert.ok(n >= 60, `機器初稿應有 60 筆以上，實際 ${n}`);
});

test('機器初稿不進答案索引：非 reviewed 的語言版本沒有對應的 chunk', () => {
  const idx = buildSearchIndex(govern('2026-10-14')).public;
  const bad = [];
  const byId = new Map(site.all.map((x) => [x.id, x]));
  for (const c of idx) {
    if (c.lang === 'zh-TW') continue;
    const it = byId.get(c.contentId);
    const v = it?.i18n?.[c.lang];
    if (v?.machineTranslated && it.languages?.[c.lang]?.status !== 'reviewed') bad.push(`${c.contentId} ${c.lang}`);
  }
  assert.deepEqual(bad.slice(0, 5), []);
});

test('lab-terms：每個含中文的檢體用語都有英文對照，且標為機器初稿', () => {
  const lt = site.master.labTerms;
  assert.equal(lt.machineTranslated, true);
  assert.ok(lt.machineTranslatedAt);
  const CJK = /[㐀-鿿]/;
  const missing = new Set();
  for (const x of site.collections.labtests) for (const sp of x.specimens) for (const k of ['name', 'timing', 'container', 'volume', 'storage', 'transport']) if (sp[k] && CJK.test(sp[k]) && !lt.terms[sp[k]]?.en) missing.add(sp[k]);
  assert.deepEqual([...missing], []);
  for (const [zh, v] of Object.entries(lt.terms)) assert.ok(v.en && !CJK.test(v.en), `${zh} 的英文含中文或為空`);
});

test('檢驗專區：/en/lab/ 與詳頁低於 15% 並顯示機器翻譯提示；zh-TW 頁維持中文、沒有提示', () => {
  const en = str(lab.render(ctxOf('en', '/lab/')));
  assert.ok(cjkStats(en).ratio < 0.1, `en lab ${(cjkStats(en).ratio * 100).toFixed(1)}%`);
  assert.ok(en.includes(t('en', 'lab.terms.machine')));
  assert.match(en, /Acute-phase serum/);
  const one = site.collections.labtests.find((x) => x.status === 'published' && langAvailable(site, x, 'en'));
  const d = str(lab.render(ctxOf('en', '/lab/x/'), { item: one }));
  assert.ok(d.includes(t('en', 'lab.terms.machine')));
  const zh = str(lab.render(ctxOf('zh-TW', '/lab/')));
  assert.ok(zh.includes('急性期血清'));
  assert.ok(!zh.includes(t('en', 'lab.terms.machine')));
  // 沒有英文對照的外語頁（th）退英文並標 lang="en"
  const th = str(lab.render(ctxOf('th', '/lab/')));
  assert.match(th, /lang="en"/);
});

test('授權名稱：外語頁不印中文的 OGDL 名稱；zh-TW 不變；CC0 不變', () => {
  assert.equal(licenseLabel(ctxOf('zh-TW'), 'OGDL-1.0'), site.config.licenses.labels['OGDL-1.0']);
  for (const lang of FOREIGN) assert.doesNotMatch(licenseLabel(ctxOf(lang), 'OGDL-1.0'), /[㐀-鿿]/, lang);
  assert.equal(licenseLabel(ctxOf('en'), 'CC0-1.0'), site.config.licenses.labels['CC0-1.0'] ?? 'CC0-1.0');
});

test('STRICT_CJK_PAGES：首頁、問答、申請服務、網站導覽（六個外語）', () => {
  for (const l of ['en', 'ja', 'tl', 'vi', 'id', 'th']) {
    for (const p of ['', 'ask/', 'apply/', 'sitemap-page/']) assert.ok(isStrictCjkPage(`/${l}/${p}index.html`), `${l} ${p}`);
  }
  assert.ok(!isStrictCjkPage('/en/about/index.html'));
  assert.ok(!isStrictCjkPage('/apply/index.html'));
  assert.equal(STRICT_CJK_PAGES.length, 4);
});

test('i18n 字串：本輪新增的鍵在七語都有值', () => {
  for (const key of ['i18n.shownEn', 'i18n.zhOnly.go', 'sitemap.zhonly', 'lab.terms.machine', 'license.OGDL-1.0']) {
    for (const l of ALL) assert.ok(STRINGS[l][key], `${l} ${key}`);
  }
  assert.equal(t('en', 'sitemap.zhonly', { n: 3 }), 'Pages available in Chinese only (3)');
});

test('單位主檔：stewardTitleEn 為英文（不含中文）', () => {
  const withEn = site.master.units.filter((u) => u.stewardTitleEn);
  assert.ok(withEn.length >= 10);
  for (const u of withEn) assert.doesNotMatch(u.stewardTitleEn, /[㐀-鿿]/, u.id);
});
