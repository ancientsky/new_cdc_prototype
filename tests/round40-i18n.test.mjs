// 第四十輪（issue #72、#73、#74、#76）：多語。
// #72 詞彙鍵值外洩（印尼文頁顯示 term.influenza）；#73 外語頁夾雜中文；#74 語言選單與缺譯文提示、補譯；#76 來臺旅客入境健康資訊。
// 不需要先 build：模板直接渲染、純函式直接呼叫；dist 掃描的部分用合成 HTML 測。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { govern } from './helpers.mjs';
import { makeCtx, langAvailable } from '../scripts/lib/pages.mjs';
import { validateSite } from '../scripts/lib/validate.mjs';
import { buildSearchIndex } from '../scripts/lib/index-builder.mjs';
import { glossaryTerm, glossaryTermInfo, glossaryField } from '../src/client/glossary-term.js';
import { sitMetricValue, sitBasisInfo, fmtNum } from '../src/client/situation-text.js';
import { visibleText, termKeyLeaks, cjkStats, checkI18nQuality, summarizeI18nQuality } from '../scripts/lib/i18n-quality.mjs';
import { diseaseName, localText, titleLink, sitField, multilingualScheduleCard } from '../src/templates/public/_partials.mjs';
import { layout } from '../src/templates/layout.mjs';
import * as home from '../src/templates/public/home.mjs';
import * as vaccines from '../src/templates/public/vaccines.mjs';
import * as topics from '../src/templates/public/topics.mjs';
import { t } from '../src/client/i18n.js';
import { engineFromSite } from '../eval/run-eval.mjs';

const site = govern('2026-10-11');
const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const ctxOf = (lang, p = '/', alternates = LANGS) => makeCtx(site, lang, { path: p, alternates });
const KEY = /\bterm\.[a-z]/;

/* ───────── #72 詞彙鍵值 ───────── */

test('#72 glossaryTerm：id → id_；七語都不會回傳 term.* 識別碼；缺譯文退英文再退中文', () => {
  assert.equal(glossaryField('id'), 'id_');
  assert.equal(glossaryField('vi'), 'vi');
  for (const g of site.master.glossary) {
    for (const l of LANGS) {
      const s = glossaryTerm(g, l);
      assert.ok(s, `${g.id} ${l} 空字串`);
      assert.doesNotMatch(s, KEY, `${g.id} ${l} 回傳了識別碼`);
    }
  }
  const flu = site.master.glossary.find((g) => g.id === 'term.influenza');
  assert.equal(glossaryTerm(flu, 'id'), flu.id_);
  // 合成：只有中文
  assert.deepEqual(glossaryTermInfo({ id: 'term.x', 'zh-TW': '某病' }, 'id'), { text: '某病', lang: 'zh-TW', machine: false });
  // 合成：印尼文欄位誤填成識別碼也不能外洩
  assert.equal(glossaryTerm({ id: 'term.x', 'zh-TW': '某病', en: 'X disease', id_: 'term.x' }, 'id'), 'X disease');
});

test('#72 diseaseName 在印尼文頁回傳印尼文病名（第四十輪前回傳 term.influenza）', () => {
  const ctx = ctxOf('id');
  for (const id of ['disease.influenza', 'disease.dengue', 'disease.enterovirus', 'disease.covid-19']) {
    const n = diseaseName(ctx, site.diseaseMasterById.get(id));
    assert.ok(n && !KEY.test(n), `${id} → ${n}`);
  }
  assert.equal(diseaseName(ctx, site.diseaseMasterById.get('disease.dengue')), 'Demam berdarah dengue');
});

test('#72 詞彙主檔：machineTranslated 只用頁面語言碼；schema 驗證通過', () => {
  const marked = site.master.glossary.filter((g) => g.machineTranslated);
  assert.ok(marked.length >= 5, '本輪補的機器翻譯初稿要標 machineTranslated');
  for (const g of marked) for (const l of g.machineTranslated) assert.ok(['en', 'ja', 'tl', 'vi', 'id', 'th'].includes(l), `${g.id} ${l}`);
  assert.deepEqual(validateSite(site), []);
});

test('#72 鍵值外洩檢查：可見文字的 term.* 抓得到；code／pre／script／屬性不算', () => {
  assert.deepEqual(termKeyLeaks('<p>Penyakit: term.influenza</p>'), ['term.influenza']);
  assert.deepEqual(termKeyLeaks('<pre><code>"id": "term.mpox"</code></pre><dt id="term.mpox">Mpox</dt><script>x="term.flu"</script>'), []);
});

test('#72 checkI18nQuality 掃 dist：鍵值外洩讓 summarize 回報 fail；中文比例只警告', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r40-'));
  fs.mkdirSync(path.join(dir, 'id'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'en', 'about'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<html lang="zh-TW"><body><p>中文正本全是中文</p></body></html>');
  fs.writeFileSync(path.join(dir, 'id', 'index.html'), '<html lang="id"><body><p>Situasi: term.influenza naik</p></body></html>');
  // 第四十八輪：/en/ 首頁與 /en/ask/ 的中文比例超標改為錯誤（見 round48-ui.test.mjs），這個「只警告」的情境改用一般內頁
  fs.writeFileSync(path.join(dir, 'en', 'about', 'index.html'), '<html lang="en"><body><p>流感疫情上升中請注意</p><p>Flu</p></body></html>');
  const rep = checkI18nQuality(dir, { threshold: 0.15, allow: [] });
  assert.deepEqual(
    rep.termLeaks.map((r) => r.page),
    ['/id/index.html'],
  );
  assert.equal(rep.cjk.checked, 2, 'zh-TW 頁不列入');
  assert.equal(rep.cjk.worst[0].page, '/en/about/index.html');
  const logs = [];
  assert.equal(summarizeI18nQuality(rep, { log: (m) => logs.push(m), mode: 'warn' }).fail, true, '鍵值外洩一定 fail');
  assert.ok(logs.some((l) => l.includes('最高的 10 頁')));
  rep.termLeaks = [];
  assert.equal(summarizeI18nQuality(rep, { log: () => {}, mode: 'warn' }).fail, false, '中文比例預設只警告');
  assert.equal(summarizeI18nQuality(rep, { log: () => {}, mode: 'error' }).fail, true, 'I18N_CJK_CHECK=error 改擋');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ───────── #73 中文比例與共用 helper ───────── */

test('#73 cjkStats：lang="zh-TW"／lang="ja" 的元素與白名單不算夾雜', () => {
  assert.equal(cjkStats('<p>Hello <span lang="zh-TW">中文標題</span></p>').cjk, 0);
  assert.equal(cjkStats('<nav><a lang="ja">日本語</a><a lang="zh-TW">繁體中文</a></nav><p>Home</p>').cjk, 0);
  assert.equal(cjkStats('<p>Taiwan CDC 疾管署</p>', { allow: ['疾管署'] }).cjk, 0);
  assert.ok(cjkStats('<p>Basis：類流感門急診就診率</p>').ratio > 0.5);
  assert.equal(visibleText('<p>a<datalist><option>日本</option></datalist>b</p>'), 'a b');
});

test('#73 疫情數字：外語頁由 metricNumeric＋單位樣板組字，不顯示「本土 23 例」', () => {
  const dengue = site.situation.items.find((i) => i.disease === 'disease.dengue');
  const measles = site.situation.items.find((i) => i.disease === 'disease.measles');
  const tEn = (k, v) => t('en', k, v);
  assert.equal(
    sitMetricValue(dengue, 'zh-TW', (k, v) => t('zh-TW', k, v)),
    '本土 23 例',
    'zh-TW 用正本',
  );
  assert.equal(sitMetricValue(dengue, 'en', tEn), '23 local cases');
  assert.equal(
    sitMetricValue(dengue, 'id', (k, v) => t('id', k, v)),
    '23 kasus lokal',
  );
  assert.equal(sitMetricValue(measles, 'en', tEn), '29 cases (21 imported)');
  assert.equal(fmtNum(8700, 'en'), '8,700');
  // 日文的單位本來就是漢字（件、人），CJK 比例檢查也不掃 ja 頁；這裡只驗其他外語不會漏出中文
  for (const l of LANGS.filter((x) => x !== 'zh-TW' && x !== 'ja'))
    for (const it of site.situation.items) {
      const v = sitMetricValue(it, l, (k, vv) => t(l, k, vv));
      assert.ok(v && !/[一-鿿]/.test(v), `${it.disease} ${l} → ${v}`);
    }
});

test('#73 判定依據：有譯文用譯文；沒有譯文顯示通用說明（generic），絕不顯示中文整句', () => {
  const flu = site.situation.items.find((i) => i.disease === 'disease.influenza');
  assert.match(sitBasisInfo(flu, 'en', (k, v) => t('en', k, v)).text, /epidemic threshold/);
  const ja = sitBasisInfo(flu, 'ja', (k, v) => t('ja', k, v));
  assert.equal(ja.generic, true);
  assert.equal(ja.text, t('ja', 'status.basis.generic'));
  assert.equal(sitField(ctxOf('zh-TW'), flu, 'basis'), flu.basis);
  for (const l of ['en', 'vi', 'id', 'th', 'tl']) assert.doesNotMatch(sitField(ctxOf(l), flu, 'basis'), /[一-鿿]/, l);
});

test('#73 清單標題（titleLink）：有譯文用譯文；沒有就退英文（lang="en"）；都沒有加「僅有中文」標記與 lang／hreflang', () => {
  const base = { id: 'news.r40', type: 'news', title: '中文標題', languages: { 'zh-TW': { status: 'source' } } };
  const vi = ctxOf('vi');
  assert.deepEqual(localText(vi, { ...base, i18n: { vi: { title: 'Tiêu đề' } } }), { text: 'Tiêu đề', lang: 'vi', zhOnly: false });
  assert.deepEqual(localText(vi, { ...base, i18n: { en: { title: 'Title' } } }), { text: 'Title', lang: 'en', zhOnly: false });
  assert.equal(localText(vi, base).zhOnly, true);
  const h = String(titleLink(vi, base));
  assert.match(h, /hreflang="zh-TW"/);
  assert.match(h, /class="c-zhonly"/);
  assert.match(h, /<span lang="zh-TW">中文標題<\/span>/);
  assert.equal(String(titleLink(ctxOf('zh-TW'), base)).includes('c-zhonly'), false, '中文頁不加標記');
  // 疾病名稱：沒有該語言頁時用詞彙主檔譯名（不是中文）
  const chik = site.collections.diseases.find((d) => d.slug === 'chikungunya');
  assert.equal(localText(ctxOf('en'), chik).zhOnly, false);
});

test('#73 首頁：原型預覽列在外語頁已翻譯；外語首頁的新聞、宣導、澄清不再夾未標示的中文', () => {
  const en = String(home.render(ctxOf('en')));
  assert.equal(en.includes('切換看做法'), false);
  assert.ok(en.includes(t('en', 'home.preview.switch')));
  assert.match(en, /data-forced="Showing layout \{x\} \(forced by URL\)"/, 'ui.js 用的樣板要保留 {x}');
  const zh = String(home.render(ctxOf('zh-TW')));
  assert.ok(zh.includes('切換看做法'));
  for (const l of ['en', 'vi', 'id']) {
    const ratio = cjkStats(String(home.render(ctxOf(l)))).ratio;
    assert.ok(ratio < 0.02, `${l} 首頁中文比例 ${(ratio * 100).toFixed(1)}%`);
  }
});

/* ───────── #74 語言選單、缺譯文提示、補譯 ───────── */

test('#74 語言選單：本頁沒有的語言仍可點，但標「此頁僅有…」並帶 from／alts 到該語首頁', () => {
  const ctx = ctxOf('zh-TW', '/diseases/enterovirus/', ['zh-TW', 'en']);
  const h = String(layout(ctx, { body: '', item: null }));
  const idLink = h.match(/<a href="([^"]*)" data-lang-path="\/id"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(idLink, '印尼文連結存在');
  assert.match(idLink[1], /\/id\/\?from=%2Fdiseases%2Fenterovirus%2F&amp;alts=zh-TW,en$/);
  assert.ok(idLink[2].includes('langs__na'));
  assert.ok(idLink[2].includes(t('id', 'langname.en')), '用目標語言寫有哪些語言');
  const enLink = h.match(/<a href="([^"]*)" data-lang-path="\/en"/);
  assert.match(enLink[1], /\/en\/diseases\/enterovirus\/$/, '有的語言照舊連同一頁');
});

test('#74 首頁預留提示區塊（hidden，前端依 ?from 填網址）；每個其他語言一個連結', () => {
  const h = String(home.render(ctxOf('id')));
  const box = h.match(/<aside class="c-alert c-alert--info c-fromhint" data-from-hint hidden[\s\S]*?<\/aside>/);
  assert.ok(box, '提示區塊存在且預設 hidden');
  assert.ok(box[0].includes(t('id', 'home.fromHint.t', { lang: t('id', 'langname.id') })));
  assert.match(box[0], /data-from-alt="en" data-lang-path="\/en" hreflang="en" hidden/);
  assert.equal(/data-from-alt="id"/.test(box[0]), false, '不列自己這個語言');
  // ui.js：只接受站內路徑（防開放轉址）
  const ui = fs.readFileSync(new URL('../src/client/ui.js', import.meta.url), 'utf8');
  assert.ok(ui.includes("'[data-from-hint]'") && ui.includes('(?!\\/)'));
});

test('#74 多語兒童預防接種時程表：只在 en／vi／id 的疫苗頁連出，標「連結未驗證」', () => {
  for (const l of ['en', 'vi', 'id']) {
    const h = String(vaccines.render(ctxOf(l, '/vaccines/'), {}));
    assert.ok(h.includes('https://www.cdc.gov.tw/Category/Page/TxRW-x3WzvPhvEtxM628GA'), l);
    assert.ok(h.includes(t(l, 'link.unverified')), l);
  }
  for (const l of ['zh-TW', 'th', 'ja']) assert.equal(String(multilingualScheduleCard(ctxOf(l))), '', l);
});

test('#74 補譯：登革熱、腸病毒、結核病、流感的 id／vi／th／tl 有一分鐘重點與症狀／預防；未審核者標 machine、一級內容不渲染', () => {
  for (const slug of ['dengue', 'enterovirus', 'tuberculosis', 'influenza']) {
    const d = site.collections.diseases.find((x) => x.slug === slug);
    for (const l of ['id', 'vi', 'th', 'tl']) {
      const tr = d.i18n?.[l];
      assert.ok(tr?.keyFacts?.symptoms && tr?.keyFacts?.prevention, `${slug} ${l} keyFacts`);
      for (const k of ['symptoms', 'prevention']) assert.ok(tr.blocks?.find((b) => b.key === k)?.markdown, `${slug} ${l} ${k}`);
      const st = d.languages[l].status;
      if (st !== 'reviewed') {
        assert.equal(st, 'machine', `${slug} ${l}`);
        assert.equal(tr.machineTranslated, true, `${slug} ${l} 要標機器翻譯初稿`);
        assert.equal(langAvailable(site, d, l), false, `${slug} ${l} 一級內容未審核不渲染`);
      }
    }
  }
});

/* ───────── #76 來臺旅客 ───────── */

test('#76 來臺專區：英文為來源語言、四語可渲染、權責檢疫組、內容待確認', () => {
  const tp = site.byId.get('topic.visiting-taiwan');
  assert.ok(tp);
  assert.equal(tp.sourceLang, 'en');
  assert.equal(tp.owner, 'unit.quarantine');
  assert.ok(site.unitById.has(tp.owner));
  assert.equal(tp.verification.status, 'pending');
  for (const l of ['en', 'zh-TW', 'vi', 'id']) assert.equal(langAvailable(site, tp, l), true, l);
  for (const l of ['zh-TW', 'vi', 'id'])
    assert.deepEqual(
      tp.i18n[l].blocks.map((b) => b.key).sort(),
      tp.blocks
        .map((b) => b.key)
        .filter((k) => k !== 'before-you-travel')
        .sort(),
      `${l} 段落齊全（行前疫苗段落併在簡介）`,
    );
  const h = String(topics.render(ctxOf('en', '/topics/visiting-taiwan/'), { item: tp }));
  for (const s of ['1922', '119', 'quarantine', 'mosquito', 'health check']) assert.ok(h.toLowerCase().includes(s.toLowerCase()), s);
});

test('#76 外語首頁「出國與入境」分成出國／來台兩個入口；中文首頁維持原卡', () => {
  for (const l of ['en', 'vi', 'id']) {
    const h = String(home.render(ctxOf(l)));
    assert.match(h, /class="c-task c-task--split"/, l);
    assert.ok(h.includes('/topics/visiting-taiwan/'), l);
    assert.ok(h.includes(t(l, 'home.travel.in')), l);
  }
  const th = String(home.render(ctxOf('th')));
  assert.match(th, /href="[^"]*\/en\/topics\/visiting-taiwan\/" hreflang="en"/, '泰文沒有本語言版，連英文版');
  assert.equal(String(home.render(ctxOf('zh-TW'))).includes('c-task--split'), false);
});

test('#76 答案引擎：來臺問句引用來臺專區（英文來源 chunk 進索引）', () => {
  const s = govern('2026-10-11');
  s.searchIndex = buildSearchIndex(s);
  assert.ok(s.searchIndex.public.some((c) => c.contentId === 'topic.visiting-taiwan' && c.lang === 'en'));
  const e = engineFromSite(s);
  for (const q of ['What vaccines do I need before traveling to Taiwan?', 'I am visiting Taiwan next month, what precautions?']) {
    const r = e.answer(q, { lang: 'en' });
    assert.ok(!r.refusal, q);
    assert.ok(
      (r.sources ?? []).some((x) => (x.contentId ?? x.id) === 'topic.visiting-taiwan'),
      q,
    );
  }
  const ev = s.governance.evalSet.questions;
  for (const id of ['ML008', 'ML009', 'ML010', 'ML011'])
    assert.ok(
      ev.some((q) => q.id === id),
      id,
    );
  assert.deepEqual(ev.find((q) => q.id === 'ML011').requires, ['i18n:disease.dengue:id'], '印尼文題在譯文審核前 skipped');
});
