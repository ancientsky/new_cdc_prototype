// 第五十一輪：全文搜尋的「精選結果」——查詢點名疾病或疫苗（正名或別名）時，該主題的一級頁面放在第一位（docs/ask-search-llm.md 第 16 節）。
// 起因：英文 /en/search/?q=dengue 的疾病頁只排第 9–10（Pagefind 分數對詞頻飽和，十來頁短頁都在 18.4–18.7 分）。
// 不需要 dist 的部分：正規化、比對規則（詞界、遮蔽、最長優先）、七語資料、Pagefind 標籤；需要 dist 與 Playwright 的端到端在缺少時 skip。
import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite } from '../scripts/lib/load.mjs';
import { makeCtx, langAvailable } from '../scripts/lib/pages.mjs';
import { bbNorm, matchBestBets } from '../src/client/search-bestbet.js';
import { bestBetData, nameFormsOf } from '../src/templates/public/_bestbet.mjs';
import { pagefindFor, pagefindMarks } from '../src/templates/public/_pagefind.mjs';
import { STRINGS, t as nodeT } from '../src/client/i18n.js';
import { distBasePath } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = loadSite(config);
const DATA = Object.fromEntries(config.langs.map((l) => [l.code, bestBetData(makeCtx(SITE, l.code))]));
const ids = (q, lang = 'zh-TW') => matchBestBets(q, DATA[lang]).map((b) => b.id);

// ───────────────────────── 正規化與比對規則（純函式） ─────────────────────────

test('bbNorm：全形轉半形、小寫、拉丁字母去聲調、標點變空白、中泰文字旁的空白拿掉', () => {
  assert.equal(bbNorm('ＤＥＮＧＵＥ'), 'dengue');
  assert.equal(bbNorm('Sốt xuất huyết'), 'sot xuat huyet');
  assert.equal(bbNorm('Đậu mùa khỉ'), 'dau mua khi');
  assert.equal(bbNorm('COVID-19'), 'covid 19');
  assert.equal(bbNorm('MMR 疫苗'), bbNorm('MMR疫苗'));
  assert.equal(bbNorm('腸病毒 71 型疫苗'), '腸病毒71型疫苗');
  assert.equal(bbNorm('  登革熱？ '), '登革熱');
});

test('nameFormsOf：括號內外各算一個名稱（括號內標為次要）；泰文「โรค」、越南文「bệnh」前綴可省略', () => {
  const f = (n, l) => nameFormsOf(n, l).map((x) => `${x.f}${x.inner ? '*' : ''}`);
  assert.deepEqual(f('人類免疫缺乏病毒感染（愛滋）'), ['人類免疫缺乏病毒感染愛滋', '人類免疫缺乏病毒感染', '愛滋*']);
  assert.ok(f('Tuberculosis (TB)').includes('tb*'));
  assert.ok(f('โรคหัด', 'th').includes('หัด'));
  assert.ok(f('Bệnh sởi', 'vi').includes('soi'));
  assert.deepEqual(f('a'), [], '一個字不算名稱');
});

test('中文：正名、別名（含第五十一輪新增的「骨痛熱症」）、疫苗名都給該主題頁；長的名稱優先', () => {
  assert.deepEqual(ids('登革熱'), ['disease.dengue']);
  assert.deepEqual(ids('骨痛熱症'), ['disease.dengue'], '香港、澳門對登革熱的稱呼（疾病主檔 aliases）');
  assert.deepEqual(ids('天狗熱'), ['disease.dengue']);
  assert.deepEqual(ids('登革熱症狀'), ['disease.dengue'], '名稱後面接別的字仍算（中文沒有空白）');
  assert.deepEqual(ids('流感疫苗'), ['vaccine.influenza'], '疫苗名比病名長，優先');
  assert.deepEqual(ids('流感'), ['disease.influenza']);
  assert.deepEqual(ids('德國麻疹'), ['disease.rubella'], '不會另外再給麻疹');
  assert.deepEqual(ids('麻疹疫苗'), ['vaccine.mmr'], 'MMR 疫苗頁的別名');
  assert.deepEqual(ids('HIV'), ['disease.hiv'], '拉丁字母名稱中文版也收');
  assert.deepEqual(ids('登革熱 瘧疾'), ['disease.dengue', 'disease.malaria'], '兩個名稱給兩張卡，依查詢順序');
});

test('詞界：名稱只躲在「指別的東西」的更長名稱裡，或查詢只是名稱的一部分，都不給精選結果', () => {
  assert.deepEqual(ids('性病'), [], '第三十一輪的案例：不得給「急性病毒性A型肝炎」');
  assert.deepEqual(ids('急性病'), []);
  assert.deepEqual(ids('登革'), [], '名稱的一部分不算');
  assert.deepEqual(ids('禽流感'), [], '「流感」躲在新型A型流感的別名「禽流感」裡');
  assert.deepEqual(ids('多重抗藥性結核病'), [], '「結核病」躲在 MDR-TB 的正名裡（沒有專頁）');
  assert.deepEqual(ids('avian influenza', 'en'), []);
  assert.deepEqual(ids('fluid', 'en'), [], '拉丁字母名稱要整個字（flu ≠ fluid）');
  assert.deepEqual(ids('TB', 'en'), ['disease.tuberculosis']);
  assert.deepEqual(ids('tb test', 'en'), [], '兩個字以下的縮寫只在整個查詢就是它時才算');
  assert.deepEqual(ids('A型肝炎疫苗'), ['disease.hepatitis-a'], '疫苗名不遮它預防的疾病（A 肝疫苗沒有專頁，給 A 肝頁）');
});

test('外語：英文、越南文（含不打聲調）、印尼文、泰文；該語言沒有這一頁就連中文正本並標語言', () => {
  const en = matchBestBets('dengue', DATA.en)[0];
  assert.equal(en.id, 'disease.dengue');
  assert.ok(en.u.endsWith('/en/diseases/dengue/') && !en.l, en.u);
  assert.equal(en.t, 'Dengue fever');
  assert.ok(en.s && !/[一-鿿]/.test(en.s), '英文頁有英文摘要');
  assert.deepEqual(ids('influenza vaccine', 'en'), ['vaccine.influenza']);
  assert.deepEqual(ids('Mpox', 'en'), ['disease.mpox']);
  for (const q of ['sốt xuất huyết', 'sot xuat huyet', 'Sốt xuất huyết Dengue']) {
    const vi = matchBestBets(q, DATA.vi)[0];
    assert.ok(vi?.u.endsWith('/vi/diseases/dengue/'), `${q} → ${vi?.u}`);
  }
  const id = matchBestBets('demam berdarah', DATA.id)[0];
  assert.equal(id.id, 'disease.dengue');
  assert.ok(id.u.endsWith('/diseases/dengue/') && !id.u.includes('/id/'), '印尼文沒有審閱過的登革熱頁 → 中文正本');
  assert.equal(id.l, 'zh-TW');
  assert.equal(id.t, '登革熱');
  assert.equal(id.a, 'Demam berdarah dengue', '附印尼文名稱，讀者認得');
  assert.equal(id.s, undefined, '退回中文頁時不放中文摘要');
  assert.deepEqual(ids('ไข้เลือดออก', 'th'), ['disease.dengue']);
  assert.deepEqual(ids('หัด', 'th'), ['disease.measles'], '泰文省略「โรค」');
  assert.deepEqual(ids('หัดเยอรมัน', 'th'), ['disease.rubella']);
  assert.deepEqual(ids('dengue', 'th'), ['disease.dengue'], '英文病名每種語言都收');
});

test('資料：每種語言的每張卡都指到真的會輸出的頁（該語言有頁就連該語言，否則中文正本）；大小在 16 KB 內', () => {
  const published = [...SITE.collections.diseases, ...SITE.collections.vaccines].filter((x) => x.status === 'published');
  for (const l of config.langs) {
    const d = DATA[l.code];
    assert.equal(d.bets.length, published.length, `${l.code}：每個已發布的疾病頁、疫苗頁一張卡`);
    for (const b of d.bets) {
      const item = published.find((x) => x.id === b.id);
      const local = langAvailable(SITE, item, l.code);
      const seg = b.type === 'disease' ? 'diseases' : 'vaccines';
      assert.ok(b.u.endsWith(`${local && l.path ? l.path : ''}/${seg}/${item.slug}/`), `${l.code} ${b.id} ${b.u}`);
      assert.equal(!!b.l, !local, `${l.code} ${b.id}：退回中文頁才標語言`);
      if (!local && l.path) assert.ok(!b.u.includes(`${l.path}/`), `${l.code} ${b.id}：沒有該語言頁卻連到 ${b.u}`);
    }
    assert.ok(
      d.keys.every(([k], i) => i === 0 || d.keys[i - 1][0].length >= k.length),
      '長的名稱排前面',
    );
    const bytes = Buffer.byteLength(JSON.stringify(d));
    assert.ok(bytes < 16 * 1024, `${l.code} ${bytes} bytes`);
  }
});

test('Pagefind 標籤：只有疾病頁、疫苗頁的主頁帶 canon 篩選值（給精選結果去重）', () => {
  const item = SITE.byId.get('disease.dengue');
  const ctx = (p) => ({ t: (k) => nodeT('zh-TW', k), path: p });
  const pf = pagefindFor({ item });
  assert.deepEqual(pf.canon, { id: 'disease.dengue', path: '/diseases/dengue/' });
  assert.ok(String(pagefindMarks(ctx('/diseases/dengue/'), pf).tail).includes('data-pagefind-filter="canon:disease.dengue"'));
  assert.ok(!String(pagefindMarks(ctx('/topics/dengue/'), pf).tail).includes('canon:'), '借用同一個 item 的其他頁不帶');
  assert.equal(pagefindFor({ item: SITE.collections.faq?.[0] ?? { type: 'faq' } })?.canon ?? null, null);
});

test('前端：search.js 用 search-bestbet.js；新字串七語齊備', () => {
  const js = fs.readFileSync(path.join(ROOT, 'src/client/search.js'), 'utf8');
  assert.match(js, /from '\.\/search-bestbet\.js'/);
  for (const k of ['search.best.h', 'search.best.note', 'search.status.best', 'search.status.bestonly'])
    for (const l of Object.keys(STRINGS)) assert.ok(STRINGS[l][k], `${k} ${l}`);
});

// ───────────────────────── 端到端（Playwright，需要 BASE_PATH='' 或任意 basePath 的 dist） ─────────────────────────
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const hasIndex = fs.existsSync(path.join(DIST, 'pagefind/pagefind-entry.json'));
const PW = process.env.PW_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

/** 與 round28 相同：套 dist/headers/headers.json 的 CSP，端到端同時驗證精選結果在正式 CSP 下能跑 */
async function withBrowser(tc, fn) {
  if (!hasIndex) return tc.skip('dist 尚未建置（或 PAGEFIND=off）');
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) return tc.skip('沒有 Playwright／Chromium');
  const hj = path.join(DIST, 'headers/headers.json');
  const headers = fs.existsSync(hj) ? JSON.parse(fs.readFileSync(hj, 'utf8')).headers : {};
  const base = distBasePath(DIST);
  const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (base && u.startsWith(base)) u = u.slice(base.length) || '/';
    let f = path.join(DIST, u);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v.replace('upgrade-insecure-requests', '').replace(/;\s*;/g, ';'));
    if (!fs.existsSync(f)) {
      res.statusCode = 404;
      f = path.join(DIST, '404.html');
    }
    res.setHeader('Content-Type', MIME[path.extname(f)] ?? 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${srv.address().port}${base}`;
  const { chromium } = await import(pathToFileURL(PW).href);
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    await fn({ browser, origin, base });
  } finally {
    await browser.close();
    srv.close();
  }
}
async function open(browser, url, viewport = { width: 1280, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.goto(url);
  // 等搜尋跑完（狀態列不再是「搜尋中…」，而且有結果或明確的查無訊息）
  await page.waitForFunction(
    () => {
      const s = document.querySelector('#search-status')?.textContent ?? '';
      return (
        s && !/搜尋中|Searching|Mencari|กำลังค้นหา|Đang tìm/.test(s) && (document.querySelector('#search-results li') || /沒有|No |Tidak|ไม่|Không/.test(s))
      );
    },
    null,
    { timeout: 20000 },
  );
  return { page, problems };
}
const links = (page) => page.$$eval('#search-best:not([hidden]) li h3 a, #search-results li h3 a', (a) => a.map((x) => x.getAttribute('href')));

test('端到端：英文 dengue ⇒ 疾病頁第一位（精選結果），清單不重複；標題階層、live region 朗讀、無錯誤、無 CSP 違規', async (tc) => {
  await withBrowser(tc, async ({ browser, origin, base }) => {
    const { page, problems } = await open(browser, `${origin}/en/search/?q=dengue`);
    const all = await links(page);
    assert.equal(all[0], `${base}/en/diseases/dengue/`, all.join(' '));
    assert.equal(all.filter((u) => u === `${base}/en/diseases/dengue/`).length, 1, '不重複');
    assert.equal(await page.textContent('#search-best h2'), 'Best match');
    assert.equal(await page.getAttribute('#search-best', 'aria-labelledby'), 'search-best-h');
    assert.equal(await page.locator('#search-best ul > li h3 a').count(), 1);
    const status = await page.textContent('#search-status');
    assert.match(status, /^Best match: Dengue fever\. (\d+) results found for “dengue”　Showing (\d+) of \1/, status);
    assert.equal(Number(status.match(/Showing (\d+)/)[1]), (await page.locator('#search-results li').count()) + 1, '「已顯示」把精選結果算進去');
    assert.deepEqual(problems, []);
  });
});

test('端到端：中文別名、疫苗、詞界反例、篩選時不出現', async (tc) => {
  await withBrowser(tc, async ({ browser, origin, base }) => {
    let { page } = await open(browser, `${origin}/search/?q=${encodeURIComponent('骨痛熱症')}`);
    assert.equal((await links(page))[0], `${base}/diseases/dengue/`);
    assert.match(await page.textContent('#search-status'), /^精選結果：登革熱。/);
    ({ page } = await open(browser, `${origin}/search/?q=${encodeURIComponent('流感疫苗')}`));
    assert.equal((await links(page))[0], `${base}/vaccines/influenza/`);
    ({ page } = await open(browser, `${origin}/search/?q=${encodeURIComponent('性病')}`));
    assert.equal(await page.isHidden('#search-best'), true, '「性病」不給精選結果（更不能是 A 肝）');
    assert.doesNotMatch(await page.textContent('#search-status'), /精選結果/);
    ({ page } = await open(browser, `${origin}/search/?q=${encodeURIComponent('登革熱')}&type=faq`));
    assert.equal(await page.isHidden('#search-best'), true, '有篩選條件時不插入篩選外的頁');
    // 同一頁換查詢：卡片跟著換、清掉
    ({ page } = await open(browser, `${origin}/search/?q=${encodeURIComponent('麻疹')}`));
    assert.equal((await links(page))[0], `${base}/diseases/measles/`);
    await page.fill('#search-q', '抗病毒藥劑');
    await page.press('#search-q', 'Enter');
    await page.waitForFunction(() => /抗病毒藥劑」找到/.test(document.querySelector('#search-status')?.textContent ?? ''), null, { timeout: 20000 });
    assert.equal(await page.isHidden('#search-best'), true);
  });
});

test('端到端：印尼文 demam berdarah ⇒ 中文正本（標語言與「此語言無此頁」）、狀態列念印尼文名稱；320px 不橫向捲動', async (tc) => {
  await withBrowser(tc, async ({ browser, origin, base }) => {
    const { page, problems } = await open(browser, `${origin}/id/search/?q=${encodeURIComponent('demam berdarah')}`, { width: 320, height: 700 });
    const a = page.locator('#search-best li h3 a');
    assert.equal(await a.getAttribute('href'), `${base}/diseases/dengue/`);
    assert.equal(await a.getAttribute('hreflang'), 'zh-TW');
    assert.equal(await a.getAttribute('lang'), 'zh-TW');
    assert.match(await page.textContent('#search-best .c-translation-badge'), /Tidak tersedia/);
    assert.match(await page.textContent('#search-status'), /^Paling sesuai: Demam berdarah dengue\./);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(w[0] <= w[1], `320px 橫向捲動 ${w}`);
    assert.deepEqual(problems, []);
  });
});
