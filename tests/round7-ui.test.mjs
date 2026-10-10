// 第七輪（X2）呈現測試：人才招募（列表分頁籤與倒數、詳情時間軸、模擬報名頁）、採購公告、導覽、後台。
// 用 tests/round7-fixtures.mjs 的合成內容（涵蓋各階段）；X1 的真實內容就位時另有「真實資料不出現壞字串」的 smoke 測試。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCtx } from '../scripts/lib/pages.mjs';
import * as careers from '../src/templates/public/careers.mjs';
import * as procurement from '../src/templates/public/procurement.mjs';
import * as notices from '../src/templates/public/notices.mjs';
import * as about from '../src/templates/public/about.mjs';
import * as contact from '../src/templates/public/contact.mjs';
import * as admJobs from '../src/templates/admin/jobs.mjs';
import * as admTenders from '../src/templates/admin/tenders.mjs';
import * as admIndex from '../src/templates/admin/index.mjs';
import * as admTodos from '../src/templates/admin/todos.mjs';
import { KIND_LABEL, KIND_ORDER } from '../src/templates/admin/_partials.mjs';
import { layout } from '../src/templates/layout.mjs';
import { STRINGS } from '../src/client/i18n.js';
import { makeApplyNo, buildIcs, validateField } from '../src/client/careers-apply.js';
import { careersSite, govern } from './round7-fixtures.mjs';

const str = (r) => String(r);
const LANGS = ['zh-TW', 'en', 'ja', 'tl', 'vi', 'id', 'th'];
const BAD = [/href="null"/, /href="undefined"/, /href="\[object/, />undefined</, />null</, /\$\{/, /\bundefined\b/, /\[object Object\]/];
const noBad = (h, label = '') => { for (const re of BAD) assert.ok(!re.test(h), `${label} 出現 ${re}`); };

const site = careersSite();
const jobBy = (slug) => site.collections.jobs.find((j) => j.slug === slug);
const tenderBy = (slug) => site.collections.tenders.find((x) => x.slug === slug);
const ctxOf = (lang = 'zh-TW', path = '/careers/') => makeCtx(site, lang, { path, alternates: ['zh-TW', 'en'] });
const full = (mod, ctx, props = {}) => str(layout(ctx, { ...(mod.meta?.(ctx, props) ?? {}), noindex: props.apply ? true : undefined, body: mod.render(ctx, props) }));
const panel = (h, id) => { const m = h.match(new RegExp(`id="panel-j-${id}"[\\s\\S]*?(?=<div class="c-tabs__panel"|<section class="c-block c-careers__foot")`)); return m ? m[0] : ''; };
const tpanel = (h, id) => { const m = h.match(new RegExp(`id="panel-p-${id}"[\\s\\S]*?(?=<div class="c-tabs__panel"|<section class="c-block c-careers__foot")`)); return m ? m[0] : ''; };

/* ───────── /careers/ 列表 ───────── */
test('/careers/：五個分頁籤、各籤職缺數與倒數天數；篩選列有職類／地點／單位', () => {
  const h = str(careers.render(ctxOf()));
  for (const k of ['open', 'upcoming', 'review', 'result', 'history']) assert.match(h, new RegExp(`role="tab" id="tab-j-${k}"`), k);
  for (const k of ['開放中', '即將開放', '審查與甄試中', '錄取結果', '歷史']) assert.ok(h.includes(k), k);
  const count = (id) => (panel(h, id).match(/class="c-job"/g) ?? []).length;
  assert.equal(count('open'), 3); assert.equal(count('upcoming'), 1); assert.equal(count('review'), 2); assert.equal(count('result'), 1); assert.equal(count('history'), 2);
  const open = panel(h, 'open');
  assert.match(open, /剩 14 天/, '開放中卡片有倒數天數');
  assert.match(open, /c-deadline--soon[^>]*>剩 4 天/, '7 日內黃色提醒');
  assert.match(panel(h, 'upcoming'), /9 天後開放/);
  assert.match(panel(h, 'review'), /結果預計 2026-11-10 公布/);
  assert.match(panel(h, 'result'), /結果公告日 <time datetime="2026-09-25"/);
  assert.match(h, /data-job-filter="jobtype"/); assert.match(h, /data-job-filter="place"/); assert.match(h, /data-job-filter="unit"/);
  assert.match(h, /data-jobtype="約聘人員" data-place="臺北市" data-unit="unit\.acute-infectious"/);
  assert.match(h, /\/feeds\/careers\.xml/); assert.match(h, /data-subscribe="feed\.careers"/);
  assert.match(h, /人事室/);
  noBad(h, '/careers/');
});
test('/careers/：開放中卡片的報名按鈕——站內模擬 vs 外部連結 vs 無按鈕（email）', () => {
  const open = panel(str(careers.render(ctxOf())), 'open');
  const cards = open.split('<li class="c-job"').slice(1);
  const by = (slug) => cards.find((c) => c.includes(`/careers/${slug}/"`));
  assert.match(by('open-online'), /href="\/new_cdc_prototype\/careers\/open-online\/apply\/" data-job-apply="sim"/);
  assert.match(by('open-external'), /href="https:\/\/example\.gov\.tw\/apply\/123"[^>]*data-job-apply="external"/);
  assert.ok(!/data-job-apply/.test(by('open-email')), 'email 報名沒有線上報名按鈕');
});
test('/careers/：已截止職缺不出現在開放中；cancelled／result 滿 90 天在歷史', () => {
  const h = str(careers.render(ctxOf()));
  const open = panel(h, 'open');
  for (const s of ['closed-waiting', 'screening', 'result-recent', 'cancelled']) assert.ok(!open.includes(`/careers/${s}/`), s);
  const hist = panel(h, 'history');
  assert.ok(hist.includes('/careers/cancelled/') && hist.includes('/careers/result-old/'));
});
test('/careers/：七語都能渲染且沒有壞字串', () => {
  for (const lang of LANGS) {
    const h = full(careers, ctxOf(lang));
    noBad(h, `careers ${lang}`);
    assert.equal((h.match(/<h1>/g) ?? []).length, 1, lang);
  }
});

/* ───────── 詳情 ───────── */
test('詳情：時間軸五段、標示目前階段，頁首 pill 顯示階段', () => {
  const cases = { 'open-online': ['report', 'deadline', '報名中'], upcoming: ['announce', 'announce', '即將開放'], screening: ['exam', 'exam', '審查與甄試中'], 'closed-waiting': ['exam', 'exam', '已截止'], 'result-recent': ['waitlist', 'waitlist', '已公布結果'], cancelled: [null, null, '已取消'] };
  for (const [slug, [, cur, label]] of Object.entries(cases)) {
    const h = str(careers.render(ctxOf('zh-TW', `/careers/${slug}/`), { item: jobBy(slug) }));
    for (const k of ['announce', 'deadline', 'exam', 'result', 'waitlist']) assert.match(h, new RegExp(`data-step="${k}"`), `${slug} ${k}`);
    if (cur) assert.match(h, new RegExp(`aria-current="step" data-step="${cur}"`), `${slug} 目前階段`);
    else assert.ok(!/aria-current="step"/.test(h), 'cancelled 無目前階段');
    assert.match(h, new RegExp(`class="c-pill c-pill--[a-z]+">${label}</span>`), `${slug} pill`);
    assert.equal((h.match(/aria-current="step"/g) ?? []).length, cur ? 1 : 0);
    noBad(h, slug);
  }
});
test('詳情：報名方式——open 無 applyUrl 有大按鈕連 apply；外部 applyUrl 連外；closed 顯示已截止與結果預計日', () => {
  const on = str(careers.render(ctxOf(), { item: jobBy('open-online') }));
  assert.match(on, /class="c-btn c-btn--lg" href="\/new_cdc_prototype\/careers\/open-online\/apply\/"/);
  assert.match(on, /模擬線上報名/);
  const ext = str(careers.render(ctxOf(), { item: jobBy('open-external') }));
  assert.match(ext, /class="c-btn c-btn--lg" href="https:\/\/example\.gov\.tw\/apply\/123"/);
  assert.ok(!ext.includes('/open-external/apply/'));
  const cl = str(careers.render(ctxOf(), { item: jobBy('closed-waiting') }));
  assert.match(cl, /已截止，結果預計 2026-11-10 公布/);
  assert.ok(!/data-job-apply/.test(cl));
  const mail = str(careers.render(ctxOf(), { item: jobBy('open-email') }));
  assert.ok(!/data-job-apply/.test(mail) && /電子郵件/.test(mail));
  for (const sec of ['工作內容', '資格條件', '薪資待遇', '應備文件', '甄試方式與日期', '聯絡']) assert.ok(on.includes(sec), sec);
});
test('詳情：甄選結果區只有報名編號（第三十輪不公布姓名）；正取／備取表、遞補紀錄、報到須知、下架日', () => {
  const h = str(careers.render(ctxOf(), { item: jobBy('result-recent') }));
  const r = h.match(/<section class="c-block c-jobresult"[\s\S]*?<\/section>/)[0];
  assert.match(r, /data-result="list"/);
  assert.ok(!/c-masked|[○◯〇]/.test(r), '結果區沒有任何（遮罩）姓名'); assert.ok(!/<th[^>]*>[^<]*姓名/.test(r), '沒有姓名欄');
  for (const no of ['1150924-012', '1150924-007', '1150924-021', '1150924-018']) assert.ok(r.includes(no), no);
  assert.match(r, /備取有效至/); assert.match(r, /遞補紀錄/); assert.match(r, /報到須知/); assert.match(r, /id="h-result"/);
  assert.match(r, /只公布報名編號/); assert.match(r, /2027-03-26/, '顯示下架日');
  // 沒有 result 的職缺沒有結果區
  assert.ok(!str(careers.render(ctxOf(), { item: jobBy('open-online') })).includes('c-jobresult'));
});
test('詳情：資料裡就算混進姓名欄，模板也不讀、不印（個資閘門在 validate 擋，這裡是第二道）', () => {
  const bad = structuredClone(jobBy('result-recent'));
  bad.result.admitted[0].nameMasked = '王小明'; bad.result.waitlist[0].name = '陳大華';
  const h = str(careers.render(ctxOf(), { item: bad }));
  assert.ok(!h.includes('王小明') && !h.includes('陳大華') && !h.includes('王○'));
});
test('詳情：舊網址揭露（gov.legacy）由 provenance 自動帶出', () => {
  const j = structuredClone(jobBy('open-online'));
  j.gov = { ...j.gov, legacy: { items: [{ oldTitle: '舊站徵才公告', oldUrl: 'https://www.cdc.gov.tw/Category/Page/old123', status: 'migrated', verified: false }] } };
  const h = str(careers.render(ctxOf(), { item: j }));
  assert.match(h, /c-legacy/); assert.match(h, /舊站徵才公告/);
});

/* ───────── apply 子頁 ───────── */
test('pages()：apply 子頁只給 applyMethod online 且無外部 applyUrl 的職缺，且全部 noindex', () => {
  const pg = careers.pages(site);
  const apply = pg.filter((p) => p.path.endsWith('/apply/') && p.lang === 'zh-TW');
  assert.ok(apply.length >= 7);
  for (const p of apply) assert.equal(p.noindex, true);
  assert.ok(!pg.some((p) => p.path === '/careers/open-external/apply/'), '外部報名沒有站內 apply');
  assert.ok(!pg.some((p) => p.path === '/careers/open-email/apply/'), 'email 報名沒有站內 apply');
  assert.ok(pg.some((p) => p.path === '/careers/open-online/apply/' && p.props.open === true));
  assert.ok(pg.some((p) => p.path === '/careers/closed-waiting/apply/' && p.props.open === false));
  assert.ok(pg.every((p) => !p.path.includes('//') && p.path.startsWith('/careers/')));
});
test('apply（open）：橫幅、三步驟、即時驗證所需屬性、localStorage 腳本、檔案只列檔名', () => {
  const j = jobBy('open-online');
  const ctx = ctxOf('zh-TW', '/careers/open-online/apply/');
  const h = full(careers, ctx, { item: j, apply: true, open: true });
  assert.match(h, /原型示範：資料只存在你的瀏覽器，不會送出/);
  assert.match(h, /<meta name="robots" content="noindex(, nofollow)?">/);
  assert.equal((h.match(/data-step-ind="/g) ?? []).length, 3);
  assert.equal((h.match(/<fieldset class="c-apply__step" data-step="/g) ?? []).length, 3);
  for (const t of ['基本資料與聯絡方式', '學經歷與應備文件', '聲明與確認']) assert.ok(h.includes(t), t);
  assert.match(h, /data-apply-errors[^>]*role="alert" aria-live="assertive"/);
  assert.match(h, /aria-required="true"/); assert.match(h, /type="file"/);
  assert.equal((h.match(/type="file"/g) ?? []).length, j.requiredDocuments.length, '每項應備文件一個檔案欄');
  assert.match(h, /data-apply-clear/); assert.match(h, /data-r-print/); assert.match(h, /data-r-json/); assert.match(h, /data-r-ics/);
  assert.match(h, /不是正式報名/);
  assert.match(h, /<script type="module" src="\/new_cdc_prototype\/assets\/js\/careers-apply\.js">/);
  assert.match(h, /data-exams="\[\{&quot;stage&quot;:&quot;筆試&quot;,&quot;date&quot;:&quot;2026-11-14&quot;/);
  const js = fs.readFileSync(new URL('../src/client/careers-apply.js', import.meta.url), 'utf8');
  assert.match(js, /localStorage/); assert.match(js, /cdc\.apply\.draft\./); assert.match(js, /aria-invalid/);
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|FileReader|\.text\(\)|arrayBuffer/.test(js), '不送出任何請求、不讀檔案內容');
  noBad(h, 'apply');
});
test('apply（非 open）：closed／upcoming／cancelled 顯示已截止或尚未開放頁，不含表單與腳本', () => {
  const pg = (slug) => { const j = jobBy(slug); const open = false; const ctx = ctxOf('zh-TW', `/careers/${slug}/apply/`); return full(careers, ctx, { item: j, apply: true, open }); };
  const closed = pg('closed-waiting');
  assert.match(closed, /已截止，結果預計 2026-11-10 公布/); assert.ok(!closed.includes('data-apply-root') && !closed.includes('careers-apply.js'));
  assert.match(closed, /原型示範：資料只存在你的瀏覽器，不會送出/);
  assert.match(pg('upcoming'), /尚未開放/); assert.match(pg('upcoming'), /2026-10-10/);
  assert.match(pg('cancelled'), /已取消/);
  assert.match(pg('result-recent'), /甄選結果已於 2026-09-25 公布/);
});
test('careers-apply.js 純函式：報名編號、驗證、.ics', () => {
  assert.match(makeApplyNo(new Date(2026, 9, 4)), /^CDC-20261004-[A-HJ-NP-Z2-9]{6}$/);
  assert.notEqual(makeApplyNo(), makeApplyNo());
  assert.equal(makeApplyNo(new Date(2026, 0, 5), () => new Uint8Array(6)), 'CDC-20260105-AAAAAA');
  const v = (n, val, o) => validateField(n, val, { today: '2026-10-04', ...o });
  assert.equal(v('name', '', { required: true, label: '姓名' }).key, 'japply.err.required');
  assert.equal(v('name', '王小明', { required: true }), null);
  assert.equal(v('address', '', {}), null, '選填可空');
  assert.equal(v('phone', '0912345678', { required: true }), null); assert.equal(v('phone', '02-23959825', { required: true }), null); assert.ok(v('phone', '12345', { required: true }));
  assert.equal(v('email', 'a@b.tw', { required: true }), null); assert.ok(v('email', 'a@b', { required: true }));
  assert.equal(v('birth', '1990-05-20', { required: true }), null); assert.ok(v('birth', '2027-01-01', { required: true })); assert.ok(v('birth', '1990-02-31', { required: true }));
  assert.equal(v('years', '3', { required: true }), null); assert.ok(v('years', '99', { required: true })); assert.ok(v('years', '-1', { required: true }));
  assert.equal(v('education', '', { kind: 'select', required: true, label: '最高學歷' }).key, 'japply.err.pick');
  assert.equal(v('doc-0', null, { kind: 'file', required: true, label: '履歷表' }).key, 'japply.err.file');
  assert.equal(v('doc-0', { name: 'a.exe', size: 1 }, { kind: 'file', required: true }).key, 'japply.err.filetype');
  assert.equal(v('doc-0', { name: 'a.pdf', size: 11 * 1024 * 1024 }, { kind: 'file', required: true }).key, 'japply.err.filesize');
  assert.equal(v('doc-0', { name: 'a.pdf', size: 100 }, { kind: 'file', required: true }), null);
  assert.equal(v('consent', false, { kind: 'checkbox', label: '同意' }).key, 'japply.err.check');
  const ics = buildIcs({ title: '測試職缺', exams: [{ stage: '筆試', date: '2026-11-14', note: '上午' }, { stage: '口試', date: '2026-11-28' }, { stage: '實作' }], no: 'CDC-20261004-AAAAAA', now: new Date(Date.UTC(2026, 9, 4)) });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2, '沒有日期的階段不產生事件');
  assert.match(ics, /DTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261115/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, '行長 ≤ 75 octets');
});

/* ───────── 採購 ───────── */
test('/procurement/：分頁籤與卡片欄位（案號、採購方式、預算、投標截止、開標日、採購網外連）', () => {
  const ctx = ctxOf('zh-TW', '/procurement/');
  const h = str(procurement.render(ctx));
  for (const k of ['open', 'closed', 'opened', 'awarded', 'failed']) assert.match(h, new RegExp(`id="tab-p-${k}"`), k);
  for (const k of ['招標中', '已截止', '已開標', '已決標', '流標']) assert.ok(h.includes(k), k);
  const n = (id) => (tpanel(h, id).match(/class="c-job c-tender"/g) ?? []).length;
  assert.deepEqual(['open', 'closed', 'opened', 'awarded', 'failed'].map(n), [1, 1, 2, 2, 1]);
  const open = tpanel(h, 'open');
  assert.match(open, /標案案號/); assert.match(open, /公開招標/); assert.match(open, /NT\$ 3,500,000/); assert.match(open, /投標截止 <time datetime="2026-10-20"/); assert.match(open, /開標日/);
  assert.match(open, /href="https:\/\/web\.pcc\.gov\.tw\/tps\/pss\/tender\.do\?id=TEST"/); assert.match(open, /剩 19 天/);
  assert.match(tpanel(h, 'awarded'), /示範資訊股份有限公司/);
  assert.match(h, /\/feeds\/procurement\.xml/);
  noBad(h, '/procurement/');
  for (const lang of LANGS) noBad(full(procurement, ctxOf(lang, '/procurement/')), `procurement ${lang}`);
});
test('/procurement/{slug}/：標案資訊表、時程、決標資訊、聯絡', () => {
  const aw = str(procurement.render(ctxOf('zh-TW', '/procurement/awarded-one/'), { item: tenderBy('awarded-one') }));
  for (const k of ['標案案號', '採購方式', '預算金額', '投標截止', '開標日', '決標日', '得標廠商', '決標金額', '聯絡']) assert.ok(aw.includes(k), k);
  assert.match(aw, /NT\$ 3,280,000/); assert.match(aw, /aria-current="step" data-step="award"/);
  assert.match(aw, />已決標</);
  const open = str(procurement.render(ctxOf('zh-TW', '/procurement/open-one/'), { item: tenderBy('open-one') }));
  assert.match(open, /尚未決標/); assert.match(open, /aria-current="step" data-step="deadline"/);
  const failed = str(procurement.render(ctxOf('zh-TW', '/procurement/failed-one/'), { item: tenderBy('failed-one') }));
  assert.match(failed, /本標案流標/); assert.ok(!/aria-current="step"/.test(failed));
  noBad(aw); noBad(open); noBad(failed);
  assert.match(procurement.markdown(ctxOf(), { item: tenderBy('awarded-one') }), /得標廠商：示範資訊股份有限公司/);
});
test('pages()：careers 與 procurement 路徑對得上（/careers/{slug}/、/procurement/{slug}/）', () => {
  assert.ok(careers.pages(site).some((p) => p.path === '/careers/open-online/' && p.md));
  assert.ok(procurement.pages(site).some((p) => p.path === '/procurement/awarded-one/'));
  assert.equal(procurement.pages(site).filter((p) => p.lang === 'zh-TW').length, 7);
});

/* ───────── 導覽 ───────── */
test('footer：「更多服務」拆成人才招募、採購公告兩連結；首頁更多服務同步；/notices/ 改入口卡', () => {
  const h = full(notices, ctxOf('zh-TW', '/notices/'), {});
  assert.match(h, /<a href="\/new_cdc_prototype\/careers\/">人才招募<\/a>/); assert.match(h, /<a href="\/new_cdc_prototype\/procurement\/">採購公告<\/a>/);
  assert.ok(!h.includes('>人才招募與採購<'));
  assert.equal((h.match(/class="c-entrycard"/g) ?? []).length, 2);
  assert.match(h, /3 個職缺開放報名/); assert.match(h, /1 件標案招標中/);
  assert.ok(!/id="tab-n-recruit"|id="tab-n-procurement"/.test(h), '/notices/ 不再有招募／採購頁籤');
  noBad(h, '/notices/');
  const ab = str(about.render(ctxOf('zh-TW', '/about/'))); assert.match(ab, /\/careers\//); assert.match(ab, /\/procurement\//);
  const ct = str(contact.render(ctxOf('zh-TW', '/contact/'))); assert.match(ct, /\/careers\//); assert.match(ct, /\/procurement\//);
  const en = full(careers, ctxOf('en'));
  assert.match(en, />Careers</); assert.match(en, />Procurement</);
});
test('i18n：七語的導覽、階段、分頁籤、橫幅 key 齊備；沒有未取代的 {} 佔位殘留', () => {
  const must = [...['upcoming', 'open', 'closed', 'screening', 'result', 'filled', 'cancelled'].map((s) => `job.stage.${s}`), ...['open', 'closed', 'opened', 'awarded', 'failed', 'cancelled'].map((s) => `tender.stage.${s}`),
    ...['open', 'upcoming', 'review', 'result', 'history'].map((s) => `careers.tab.${s}`), ...['open', 'closed', 'opened', 'awarded', 'failed'].map((s) => `proc.tab.${s}`),
    'careers.title', 'proc.title', 'more.careers', 'more.procurement', 'japply.banner', 'japply.title', 'job.apply.online'];
  for (const l of LANGS) for (const k of must) assert.ok(STRINGS[l][k], `${l} ${k}`);
  const keys = Object.keys(STRINGS['zh-TW']).filter((k) => /^(job|japply|careers|proc|tender)\./.test(k));
  for (const k of keys) assert.ok(STRINGS.en[k], `en ${k}`);
});

/* ───────── 後台 ───────── */
test('後台：/admin/jobs/、/admin/tenders/ 可渲染；結果上架檢核、決標逾期；儀表板卡片；待辦頁籤與 KIND_LABEL', () => {
  const ctx = makeCtx(site, 'zh-TW', { path: '/admin/jobs/' });
  const j = str(admJobs.render(ctx));
  assert.match(j, /職缺與階段/); assert.match(j, /結果上架檢核/); assert.match(j, /data-check="names"/); assert.match(j, /data-check="capacity"/); assert.match(j, /data-check="waitlist"/); assert.match(j, /data-check="unpublish"/);
  assert.match(j, /只有報名編號/); assert.ok(!/遮罩字/.test(j)); assert.match(j, /正取 2 ／ 名額 2/);
  noBad(j, 'admin jobs');
  const t = str(admTenders.render(makeCtx(site, 'zh-TW', { path: '/admin/tenders/' })));
  assert.match(t, /標案與階段/); assert.match(t, /決標逾期/); assert.match(t, /opened-overdue|測試標案 opened-overdue/);
  assert.match(t, /逾期 \d+ 日/);
  noBad(t, 'admin tenders');
  assert.deepEqual(admJobs.pages().map((p) => p.path), ['/admin/jobs/']); assert.deepEqual(admTenders.pages().map((p) => p.path), ['/admin/tenders/']);
  const idx = str(admIndex.render(ctx));
  assert.match(idx, /id="dash-jobs"/); assert.match(idx, /id="dash-tenders"/); assert.match(idx, /\/admin\/jobs\//); assert.match(idx, /\/admin\/tenders\//);
  for (const k of ['job-result-overdue', 'job-waitlist-expiring', 'job-apply-url-dead', 'job-result-unpublish', 'tender-award-overdue']) { assert.ok(KIND_LABEL[k], k); assert.ok(KIND_ORDER.includes(k), k); }
  const td = str(admTodos.render(ctx));
  for (const k of ['job-result-overdue', 'job-waitlist-expiring', 'job-apply-url-dead', 'tender-award-overdue']) assert.match(td, new RegExp(`data-kind="${k}"`), `待辦頁籤 ${k}`);
  assert.match(td, /data-panel="tender-award-overdue"[\s\S]*測試標案 opened-overdue/, '決標逾期待辦出現');
});
test('後台結果檢核：混進姓名欄、正取超額、備取過期都會被標紅', () => {
  const bad = structuredClone(jobBy('result-recent'));
  bad.result.admitted.push({ seq: 3, candidateNo: '1150924-099', nameMasked: '黃小華' });
  bad.result.waitlist.forEach((w) => { w.validUntil = '2026-09-30'; });
  const s3 = { ...site, collections: { ...site.collections, jobs: [bad] } };
  const t = str(admJobs.render(makeCtx(s3, 'zh-TW', { path: '/admin/jobs/' })));
  assert.match(t, /1 列含姓名欄/); assert.ok(!t.includes('黃小華'), '後台也不回印姓名'); assert.match(t, /正取 3 ／ 名額 2/); assert.match(t, /備取有效期已於 2026-09-30 屆滿/);
  assert.match(t, /需修正/);
});

/* ───────── 真實內容 smoke（X1 就位時） ───────── */
test('真實內容：jobs／tenders 若已存在，/careers/、/procurement/ 與每個詳情、apply 頁都能渲染且無壞字串', () => {
  const real = govern();
  const jobs = real.collections.jobs ?? [], tenders = real.collections.tenders ?? [];
  if (!jobs.length && !tenders.length) return;
  const mk = (lang, path) => makeCtx(real, lang, { path, alternates: ['zh-TW'] });
  noBad(full(careers, mk('zh-TW', '/careers/')), 'real /careers/');
  noBad(full(procurement, mk('zh-TW', '/procurement/')), 'real /procurement/');
  for (const p of careers.pages(real).filter((x) => x.lang === 'zh-TW')) noBad(full(careers, mk('zh-TW', p.path), p.props), `real ${p.path}`);
  for (const p of procurement.pages(real).filter((x) => x.lang === 'zh-TW')) noBad(full(procurement, mk('zh-TW', p.path), p.props), `real ${p.path}`);
  for (const j of jobs.filter((x) => x.result)) {
    const h = str(careers.render(mk('zh-TW', `/careers/${j.slug}/`), { item: j }));
    for (const n of [...h.matchAll(/class="c-masked">([^<]*)</g)].map((m) => m[1])) assert.match(n, /[○◯〇＊]/);
  }
});
