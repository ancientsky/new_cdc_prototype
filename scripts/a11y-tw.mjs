// 第七十五輪：新版「網站無障礙規範」（115.11.30 施行）附件一「檢測碼」預檢（docs/a11y.md 第 12 節）。
// 用法：node scripts/build.mjs && npm run a11y:tw
//       DIST_DIR=…、BASE_PATH=… 與其他腳本相同；A11Y_TW_JSON=路徑 另存機器可讀結果；在 GitHub Actions 會附加到 job summary。
// 為什麼要有這支（axe 已經在跑）：
//   - 附件一的 28 個軟體檢測碼裡，有幾條是台灣規範特有、axe／Lighthouse 都不檢查的（表情符號 title、行內連結 title、px 字級、
//     表格 scope、fieldset 分群…）。申請無障礙標章要上傳數發部 Freego 的檢測報告；Freego 是 Windows 單機工具，放不進 CI。
//     本腳本是「每個 PR 的預檢」，Freego 是「申請前的對照」，兩邊用同一組檢測碼編號，報告可以逐條對照。
//   - 不開瀏覽器、只讀 dist 的 HTML／CSS（純 Node，htmlparser2），幾秒跑完，所以能放進純內容 PR 也會跑的 test:content。
//     代價：看不到 JS 產生的畫面與 CSS 計算後的樣式（例如是否隱藏）；那部分仍由 npm run a11y（Playwright＋axe＋焦點走查）負責。
// 判定：A、AA 級的不合格 → exit 1；HM1130103C（select 未用 optgroup，Freego 判法未確認）與「多欄位表單沒有 fieldset」只列警告。
//       HM2310200C（外語片段要標 lang）第七十六輪起擋合併：模板與 pages.mjs 的安全網已把不同語言的片段標好，剩下的是真的漏標。
//       規範的專有名詞例外：中文頁上 3 個字以下的英文（WHO、Taiwan CDC）本來就不判；其他專有名詞若確定不該標，
//       在承載元素加 data-a11y-propernoun（docs/a11y.md §12.2），本腳本略過。AAA 級（HM3240900C 等）不是目標，不檢查。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTree, walk, textOf, linkText, isInlineLink, PICTO_RE, EN_WORDS_RE } from './lib/a11y-text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 檢測碼一覽（與 docs/a11y.md 第 12 節的表一致；level 是規範等級，warn 表示本腳本只列警告） */
export const CODES = {
  HM1110100C: { level: 'A', title: '<img> 要有 alt' },
  HM1110101C: { level: 'A', title: '<area> 要有 alt' },
  HM1110103C: { level: 'A', title: '字符圖案、表情符號要有 title' },
  HM1110104C: { level: 'A', title: '<input type="image"> 要有 alt' },
  HM1110105C: { level: 'A', title: '<object>／<embed> 要有替代內容' },
  HM1110106C: { level: 'A', title: 'alt="" 的裝飾圖不得有 title' },
  HM1130100C: { level: 'A', title: '標題層級不可跳級' },
  HM1130101C: { level: 'A', title: '表格標題格要有 scope' },
  HM1130102C: { level: 'A', title: 'headers 屬性要對到存在的標題格 id' },
  HM1130103C: { level: 'A', title: '<select> 以 <optgroup> 分群', warn: true },
  HM1130104C: { level: 'A', title: '表單控制元件要有 <label> 或 title' },
  HM1130105C: { level: 'A', title: '核取方塊／選項按鈕群組以 <fieldset>＋<legend> 分群' },
  HM1130200C: { level: 'A', title: '由右至左文字要標 dir' },
  HM1240102C: { level: 'A', title: '連結要放在導覽／內容等區塊（地標）內' },
  HM1240200C: { level: 'A', title: '網頁要有 <title>' },
  HM1240400C: { level: 'A', title: '相鄰的圖片連結與文字連結不可重複指向同一資源' },
  HM1240401C: { level: 'A', title: '連結要有文字；前後尚有其他內容的行內連結另需 title' },
  HM1310100C: { level: 'A', title: '<html> 要有 lang' },
  ME1320200C: { level: 'A', title: '下載檔要是開放格式（ODF、PDF、HTML、CSV、JSON…）' },
  HM1410201C: { level: 'A', title: '<iframe>／<frame> 要有 title' },
  CS2140401C: { level: 'AA', title: 'CSS 字級不得用 px' },
  HM2310200C: { level: 'AA', title: '外語片段要標 lang' },
  FORM_FIELDSET: { level: 'A', title: '（HM1130105C 延伸）多欄位表單沒有任何 <fieldset>', warn: true },
};

const CLOSED_EXT = /\.(docx?|xlsx?|pptx?|rar|wps|hwp)(?:[?#]|$)/i;
const LANDMARK_TAGS = new Set(['nav', 'main', 'header', 'footer', 'aside', 'section', 'article', 'form']);
const LANDMARK_ROLES = new Set(['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'region', 'search', 'form', 'dialog']);
const CONTROL_SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
const HEADING = /^h([1-6])$/;
const PX_FONT = /font-size\s*:\s*[^;{}"']*?\b[\d.]+px/i;
const norm = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const ancestors = function* (n) {
  for (let p = n.parent; p && p.name !== '#root'; p = p.parent) yield p;
};
const hasAncestor = (n, pred) => {
  for (const p of ancestors(n)) if (pred(p)) return true;
  return false;
};
const inInert = (n) => hasAncestor(n, (p) => p.name === 'template' || p.name === 'head' || p.name === 'script' || p.name === 'noscript');
/** 標籤的簡短表示（報告用） */
function snippet(el) {
  const a = el.attribs ?? {};
  const cls = a.class ? `.${a.class.split(/\s+/)[0]}` : '';
  const id = a.id ? `#${a.id}` : '';
  const txt = norm(textOf(el)).slice(0, 40);
  return `<${el.name}${id}${cls}>${txt ? ` ${txt}` : ''}`;
}

/**
 * 檢查一頁 HTML。
 * @param {string} html
 * @returns {{ code: string, snippet: string }[]}
 */
export function checkHtml(html) {
  const out = [];
  const add = (code, s) => out.push({ code, snippet: String(s).slice(0, 160) });
  const tree = parseTree(html);
  const all = [...walk(tree)];
  const htmlEl = all.find((e) => e.name === 'html');
  const pageLang = (htmlEl?.attribs.lang ?? '').toLowerCase();

  // HM1310100C、HM1240200C
  if (!htmlEl || !/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(htmlEl.attribs.lang ?? '')) add('HM1310100C', '<html> 沒有 lang（或格式不對）');
  const titleEl = all.find((e) => e.name === 'title' && hasAncestor(e, (p) => p.name === 'head'));
  if (!titleEl || !norm(textOf({ ...titleEl, name: 'div' }))) add('HM1240200C', '<title> 不存在或空白');

  const ids = new Set(all.map((e) => e.attribs.id).filter(Boolean));
  const labelFor = new Set(all.filter((e) => e.name === 'label' && e.attribs.for).map((e) => e.attribs.for));
  let lastLevel = 0;
  for (const el of all) {
    const a = el.attribs;
    if (el.name === 'img') {
      if (a.alt == null) add('HM1110100C', `<img src="${a.src ?? ''}">`);
      else if (a.alt === '' && a.title != null) add('HM1110106C', `<img alt="" title="${a.title}">`);
    }
    if (el.name === 'area' && !norm(a.alt)) add('HM1110101C', `<area href="${a.href ?? ''}">`);
    if (el.name === 'input' && (a.type ?? '').toLowerCase() === 'image' && !norm(a.alt)) add('HM1110104C', snippet(el));
    if ((el.name === 'object' || el.name === 'embed' || el.name === 'applet') && !norm(textOf(el)) && !norm(a.title) && !norm(a['aria-label']))
      add('HM1110105C', snippet(el));
    if ((el.name === 'iframe' || el.name === 'frame') && !norm(a.title)) add('HM1410201C', `<${el.name} src="${a.src ?? ''}">`);
    if (a.style && PX_FONT.test(a.style)) add('CS2140401C', `${snippet(el)} style="${a.style}"`);
    if (el.name === 'style') {
      const css = textOf({ ...el, name: 'div' });
      if (PX_FONT.test(css)) add('CS2140401C', `<style>：${css.match(PX_FONT)[0]}`);
    }
    // HM1130100C：標題層級（看文件順序；<template>、hidden、aria-hidden 內的不算）
    const hm = HEADING.exec(el.name);
    if (hm && !inInert(el) && !hasAncestor(el, (p) => p.attribs.hidden != null || p.attribs['aria-hidden'] === 'true') && a.hidden == null) {
      const lv = Number(hm[1]);
      if (lastLevel && lv > lastLevel + 1) add('HM1130100C', `h${lastLevel} → h${lv}：${norm(textOf(el)).slice(0, 40)}`);
      lastLevel = lv;
    }
    // HM1130101C／102C：表格
    if (el.name === 'table') {
      const cells = [...walk(el)].filter(
        (c) => (c.name === 'th' || c.name === 'td') && !hasAncestor(c, (p) => p !== el && p.name === 'table' && hasAncestor(p, (q) => q === el)),
      );
      const ths = cells.filter((c) => c.name === 'th');
      const usesHeaders = cells.some((c) => c.attribs.headers);
      if (ths.length && !usesHeaders) {
        const missing = ths.filter((th) => !th.attribs.scope);
        if (missing.length)
          add('HM1130101C', `${snippet(el)}：${missing.length}/${ths.length} 個 <th> 沒有 scope（例：${norm(textOf(missing[0])).slice(0, 20)}）`);
      }
      for (const c of cells.filter((x) => x.attribs.headers)) {
        const bad = c.attribs.headers.split(/\s+/).filter((h) => h && !ids.has(h));
        if (bad.length) add('HM1130102C', `${snippet(c)} headers="${c.attribs.headers}"（找不到 ${bad.join('、')}）`);
      }
    }
    if (el.name === 'select' && !inInert(el) && ![...walk(el)].some((c) => c.name === 'optgroup')) add('HM1130103C', snippet(el));
    // HM1130104C：可見的控制元件要有 <label for>、包在 <label> 裡，或有 title
    if ((el.name === 'input' && !CONTROL_SKIP_TYPES.has((a.type ?? 'text').toLowerCase())) || el.name === 'select' || el.name === 'textarea') {
      if (!inInert(el)) {
        const labelled = (a.id && labelFor.has(a.id)) || hasAncestor(el, (p) => p.name === 'label') || norm(a.title);
        if (!labelled)
          add(
            'HM1130104C',
            `<${el.name}${a.id ? `#${a.id}` : ''}${a.name ? ` name=${a.name}` : ''}${a['aria-label'] ? ` aria-label="${a['aria-label']}"` : ''}>`,
          );
      }
    }
    if (el.name === 'form' && !inInert(el)) {
      const ctrls = [...walk(el)].filter(
        (c) => (c.name === 'input' && !CONTROL_SKIP_TYPES.has((c.attribs.type ?? 'text').toLowerCase())) || c.name === 'select' || c.name === 'textarea',
      );
      if (ctrls.length >= 2 && ![...walk(el)].some((c) => c.name === 'fieldset')) add('FORM_FIELDSET', `${snippet(el)}：${ctrls.length} 個控制元件`);
    }
    // 連結
    if (el.name === 'a' && a.href != null && !inInert(el)) {
      const isSvg = hasAncestor(el, (p) => p.name === 'svg');
      const svgTitle = el.children.some((c) => c.name === 'title' && norm(textOf({ ...c, name: 'div' })));
      const name = linkText(el) || norm(a['aria-labelledby']) || norm(a.title) || (svgTitle ? 'svg-title' : '');
      if (!name) add('HM1240401C', `連結沒有文字：<a href="${a.href}">`);
      else if (!isSvg && a.title == null && isInlineLink(el))
        add('HM1240401C', `行內連結沒有 title：「${linkText(el).slice(0, 30)}」（在 <${el.parent.name}> 內）`);
      if (!/\bskip-link\b/.test(a.class ?? '') && !hasAncestor(el, (p) => LANDMARK_TAGS.has(p.name) || LANDMARK_ROLES.has(p.attribs.role)))
        add('HM1240102C', `${snippet(el)} href="${a.href}"`);
      if (CLOSED_EXT.test(a.href)) add('ME1320200C', `<a href="${a.href}">`);
      // HM1240400C：與下一個相鄰元素是同 href 的連結，且其中一個是圖片連結
      const sibs = el.parent.children.filter((c) => c.type !== 'text' || c.data.trim());
      const nx = sibs[sibs.indexOf(el) + 1];
      const hasPic = (x) => [...walk(x)].some((c) => c.name === 'img' || c.name === 'svg');
      if (nx && nx.name === 'a' && nx.attribs.href === a.href && (hasPic(el) || hasPic(nx))) add('HM1240400C', `${snippet(el)} ＋ ${snippet(nx)}`);
    }
  }

  // HM1130105C：同名 radio／checkbox ≥ 2 個要在 fieldset 或 role=group／radiogroup 內
  const groups = new Map();
  for (const el of all) {
    const ty = (el.attribs.type ?? '').toLowerCase();
    if (el.name === 'input' && (ty === 'radio' || ty === 'checkbox') && el.attribs.name && !inInert(el)) {
      const form = [...ancestors(el)].find((p) => p.name === 'form') ?? tree;
      const key = `${all.indexOf(form)}|${el.attribs.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    }
  }
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    if (!hasAncestor(list[0], (p) => p.name === 'fieldset' || p.attribs.role === 'group' || p.attribs.role === 'radiogroup'))
      add('HM1130105C', `name="${key.split('|')[1]}" 的 ${list.length} 個選項沒有 fieldset／role=group`);
  }

  // 文字節點：HM1110103C（表情符號）、HM1130200C（由右至左）、HM2310200C（外語片段，警告）
  const texts = [];
  const collect = (n) => {
    for (const c of n.children ?? []) {
      if (c.type === 'text') texts.push(c);
      else if (!['script', 'style', 'head', 'template', 'noscript'].includes(c.name)) collect(c);
    }
  };
  collect(tree);
  for (const tn of texts) {
    const v = tn.data;
    if (PICTO_RE.test(v)) {
      const ok = [tn.parent, ...ancestors(tn.parent)].some((p) => p && p.attribs && (p.attribs.title != null || p.attribs['aria-hidden'] === 'true'));
      if (!ok) add('HM1110103C', `「${norm(v).slice(0, 30)}」（在 ${snippet(tn.parent).slice(0, 40)} 內）`);
    }
    if (/[֐-ࣿ]/.test(v) && ![tn.parent, ...ancestors(tn.parent)].some((p) => p?.attribs?.dir)) add('HM1130200C', `「${norm(v).slice(0, 30)}」`);
    const langEl = [tn.parent, ...ancestors(tn.parent)].find((p) => p?.attribs?.lang);
    const l = (langEl ? langEl.attribs.lang : pageLang).toLowerCase();
    if (
      hasAncestor(tn, (p) => p.name === 'code' || p.name === 'pre' || p.name === 'kbd' || p.name === 'samp') ||
      ['code', 'pre', 'kbd', 'samp'].includes(tn.parent?.name)
    )
      continue;
    if ([tn.parent, ...ancestors(tn.parent)].some((p) => p?.attribs?.['data-a11y-propernoun'] != null)) continue;
    if (pageLang.startsWith('zh') && l.startsWith('zh') && !/[㐀-鿿]/.test(v)) {
      const m = v.match(EN_WORDS_RE);
      if (m) add('HM2310200C', `「${m[0].slice(0, 50)}」`);
    }
    if (pageLang && !/^(zh|ja)/.test(pageLang) && l === pageLang && (v.match(/[㐀-鿿]/g) ?? []).length >= 2)
      add('HM2310200C', `「${norm(v).slice(0, 30)}」（${pageLang} 頁面裡的中日文）`);
  }
  return out;
}

/** CSS 檔：font-size 用 px（CS2140401C） */
export function checkCss(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(new RegExp(PX_FONT.source, 'gi'))) out.push({ code: 'CS2140401C', snippet: m[0] });
  return out;
}

function listFiles(dir, ext, skip = () => false, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p)) continue;
    if (e.isDirectory()) listFiles(p, ext, skip, acc);
    else if (e.name.endsWith(ext)) acc.push(p);
  }
  return acc;
}

/**
 * 掃整個 dist。PR 預覽（dist/preview/）、Pagefind 與 vendor 的第三方檔不算（各有自己的版本與建置）。
 * @param {string} dist
 * @returns {{ pages: number, cssFiles: number, findings: { code: string, page: string, snippet: string }[] }}
 */
export function scanDist(dist, { basePath = '' } = {}) {
  const skip = (p) => {
    const rel = path.relative(dist, p).split(path.sep).join('/');
    return rel === 'preview' || rel.startsWith('preview/') || rel === 'pagefind' || rel.includes('/vendor') || rel.startsWith('vendor');
  };
  const findings = [];
  const htmlFiles = listFiles(dist, '.html', skip);
  for (const f of htmlFiles) {
    const rel = path.relative(dist, f).split(path.sep).join('/');
    const page = `${basePath}/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
    for (const x of checkHtml(fs.readFileSync(f, 'utf8'))) findings.push({ ...x, page });
  }
  const cssFiles = listFiles(path.join(dist, 'assets'), '.css', skip);
  for (const f of cssFiles)
    for (const x of checkCss(fs.readFileSync(f, 'utf8'))) findings.push({ ...x, page: `${basePath}/${path.relative(dist, f).split(path.sep).join('/')}` });
  return { pages: htmlFiles.length, cssFiles: cssFiles.length, findings };
}

/** 依檢測碼彙整（報告與測試共用） */
export function summarize(findings) {
  const by = {};
  for (const f of findings) (by[f.code] ??= []).push(f);
  const fails = findings.filter((f) => !CODES[f.code]?.warn);
  const warns = findings.filter((f) => CODES[f.code]?.warn);
  return { by, fails: fails.length, warnings: warns.length };
}

function report({ pages, cssFiles, findings }) {
  const { by, fails, warnings } = summarize(findings);
  const md = ['## 網站無障礙規範檢測碼預檢（a11y:tw）', ''];
  md.push(`- 掃描：${pages} 個 HTML、${cssFiles} 個自有 CSS；依據：網站無障礙規範（115.11.30 施行）附件一 A／AA 級軟體檢測碼`);
  md.push(`- 結果：**${fails} 項不合格**（A／AA）、${warnings} 項警告（不擋合併）`, '');
  md.push('| 檢測碼 | 等級 | 要求 | 判定 | 數量 | 頁數 |', '|---|---|---|---|---|---|');
  for (const [code, c] of Object.entries(CODES)) {
    const list = by[code] ?? [];
    md.push(
      `| ${code} | ${c.level} | ${c.title} | ${list.length ? (c.warn ? '⚠️ 警告' : '❌ 不合格') : '✅'} | ${list.length} | ${new Set(list.map((x) => x.page)).size} |`,
    );
  }
  md.push('');
  for (const [code, list] of Object.entries(by)) {
    md.push(`### ${code} ${CODES[code]?.title ?? ''}（${list.length}）`, '', '| 頁面 | 片段 |', '|---|---|');
    for (const f of list.slice(0, 5)) md.push(`| \`${f.page}\` | ${f.snippet.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    if (list.length > 5) md.push(`| … | 另有 ${list.length - 5} 筆 |`);
    md.push('');
  }
  return { text: md.join('\n'), fails, warnings, by };
}

async function main() {
  const dist = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
  const basePath = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(`找不到 ${dist}/index.html。請先建置：node scripts/build.mjs（本腳本不會自己建置）`);
    process.exit(2);
  }
  const res = scanDist(dist, { basePath });
  const r = report(res);
  console.log(r.text);
  const warnCodes = Object.entries(r.by)
    .filter(([c]) => CODES[c]?.warn)
    .map(([c, l]) => `${c}×${l.length}`);
  console.log(`\n[a11y:tw] 不合格 ${r.fails}、警告 ${r.warnings}（不擋合併）${warnCodes.length ? `：${warnCodes.join('、')}` : ''}`);
  if (process.env.A11Y_TW_JSON) {
    const json = {
      pages: res.pages,
      cssFiles: res.cssFiles,
      fails: r.fails,
      warnings: r.warnings,
      byCode: Object.fromEntries(
        Object.entries(r.by).map(([c, l]) => [c, { level: CODES[c]?.level, warn: !!CODES[c]?.warn, count: l.length, examples: l.slice(0, 5) }]),
      ),
    };
    try {
      fs.writeFileSync(process.env.A11Y_TW_JSON, `${JSON.stringify(json, null, 1)}\n`);
    } catch {
      /* 寫不出去不影響結果 */
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${r.text}\n`);
    } catch {
      /* 同上 */
    }
  }
  process.exit(r.fails ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
