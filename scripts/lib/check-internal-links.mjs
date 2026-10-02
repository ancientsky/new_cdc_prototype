#!/usr/bin/env node
// 全站連結完整性檢查（建置後）：掃 dist/**/*.html，站內連結必須指到存在的檔案，外部連結收集成清單。
//
// 抽取：href、src、action、poster、data-*url、srcset、<meta property="og:image"|twitter:image content>、
//       JSON-LD（<script type="application/ld+json">）內的 url／contentUrl。
//       一般 <script>、<template>、HTML 註解內的字串不掃（那是 client 端程式，不是連結）。
// 站內（以 basePath 開頭、相對路徑、或 siteUrl+basePath 的絕對網址）：
//   - 資料夾型路徑（/x/）需有 index.html；檔案型需存在；/x（無斜線）若 /x/index.html 存在也算通（Pages 會 301）。
//   - ?query 忽略；#anchor 檢查目標頁有該 id／name（找不到 ⇒ warning）；#t=…、#:~:text=… 等媒體／文字片段不檢。
//   - 以 / 開頭卻不在 basePath 底下 ⇒ error（missing-basepath：部署到 Pages 子路徑會 404）。
//   - 排除：/ask/?q=…（動態查詢）、mailto:、tel:、sms:、javascript:、data:、blob:。
// 外部：收集網域、次數、來源頁 → v1/governance/external-links.json；建置時不連外驗證（CI 另有 fetch-data --check-links）。
//   黑名單（example.、placeholder、localhost、127.0.0.1、TODO、xxx）⇒ error。
// 輸出：v1/governance/link-report.json（errors[]、warnings[]、counts）。
// 用法：node scripts/lib/check-internal-links.mjs [distDir] [--check] [--md]（--check 或 CI 環境下有 error ⇒ exit 1）
// 匯出：checkInternalLinks(distDir, { basePath, langs, siteUrl, md, write }) → { errors, warnings, counts, external, ok }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKIP_SCHEME = /^(mailto|tel|sms|javascript|data|blob|about):/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EXCLUDE = [/\/ask\/\?q=/];
/** 黑名單：外部網址含這些字樣 ⇒ error（佔位或示意網址不得上線） */
export const BLACKLIST = [
  { re: /^https?:\/\/(?:[^/?#]*\.)?example\.[a-z]+(?:[:/?#]|$)/i, why: 'example 網域' },
  { re: /^https?:\/\/(?:[^/?#]*\.)?example(?:[:/?#]|$)/i, why: 'example 網域' },
  { re: /placeholder/i, why: '佔位網址（placeholder）' },
  { re: /^https?:\/\/localhost(?:[:/?#]|$)/i, why: 'localhost' },
  { re: /^https?:\/\/127\.0\.0\.1(?:[:/?#]|$)/i, why: '127.0.0.1' },
  { re: /TODO/, why: 'TODO 字樣' },
  { re: /xxx/i, why: 'xxx 字樣' },
];
// 不需檢查 id 的片段：媒體時間（#t=30）、文字片段、空片段、頁首
const FRAGMENT_SKIP = /^(?:t=|:~:|top$|$)/;

const ATTR_RE = /\s(href|src|action|poster|srcset|data-[a-z0-9-]*url)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const META_IMG_RE = /<meta\s[^>]*(?:property|name)\s*=\s*["'](?:og:image|og:image:url|twitter:image)["'][^>]*>/gi;
const CONTENT_RE = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ID_RE = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const LDJSON_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const STRIP_RE = /<script\b[^>]*>[\s\S]*?<\/script>|<template\b[^>]*>[\s\S]*?<\/template>|<!--[\s\S]*?-->/gi;
const MD_LINK_RE = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out); else out.push(r);
  }
  return out;
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** 頁面檔案相對路徑 → 網址路徑（含 basePath）：about/index.html → /base/about/index.html */
const pageUrlOf = (rel, basePath) => `${basePath}/${rel}`;

export function blacklistHit(u) {
  for (const b of BLACKLIST) if (b.re.test(u)) return b.why;
  return null;
}

/**
 * @param {string} distDir 建置輸出目錄
 * @param {{ basePath?: string, langs?: Array<{code:string,path:string}|string>, siteUrl?: string, md?: boolean, write?: boolean, maxSources?: number }} opts
 */
export function checkInternalLinks(distDir, opts = {}) {
  const t0 = Date.now();
  const basePath = (opts.basePath ?? '').replace(/\/$/, '');
  const siteUrl = (opts.siteUrl ?? '').replace(/\/$/, '');
  const siteOrigin = siteUrl ? `${siteUrl}${basePath}` : null;
  const maxSources = opts.maxSources ?? 5;
  const langPrefixes = (opts.langs ?? []).map((l) => (typeof l === 'string' ? { code: l, path: `/${l}` } : l)).filter((l) => l.path);
  const langOf = (rel) => { const p = `/${rel}`; return langPrefixes.find((l) => p.startsWith(`${l.path}/`))?.code ?? 'default'; };

  const files = walk(distDir);
  const fileSet = new Set(files);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const mdFiles = opts.md ? files.filter((f) => f.endsWith('.md')) : [];

  const errors = [];
  const warnings = [];
  const counts = { pages: htmlFiles.length, mdFiles: mdFiles.length, links: 0, internal: 0, internalOk: 0, external: 0, skipped: 0, anchorsChecked: 0, errors: 0, warnings: 0, byKind: {}, byLang: {} };
  const external = new Map(); // url → { url, host, count, sources:Set }
  const idCache = new Map(); // rel → Set(ids)
  const htmlCache = new Map(); // rel → raw html

  const readHtml = (rel) => {
    if (!htmlCache.has(rel)) htmlCache.set(rel, fs.readFileSync(path.join(distDir, rel), 'utf8'));
    return htmlCache.get(rel);
  };
  const idsOf = (rel) => {
    if (idCache.has(rel)) return idCache.get(rel);
    const ids = new Set();
    const src = readHtml(rel).replace(STRIP_RE, '');
    for (const m of src.matchAll(ID_RE)) ids.add(decodeEntities(m[1] ?? m[2] ?? ''));
    idCache.set(rel, ids);
    return ids;
  };

  const issue = (list, kind, from, href, extra = {}) => {
    list.push({ kind, from: `/${from}`, href, ...extra });
    counts.byKind[kind] = (counts.byKind[kind] ?? 0) + 1;
  };

  /** 網址路徑（已去 basePath 前綴前）→ dist 內檔案相對路徑；找不到回 null */
  const resolveFile = (p) => {
    let rel = safeDecode(p).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (fileSet.has(rel)) return rel;
    if (fileSet.has(`${rel}/index.html`)) return `${rel}/index.html`;
    return null;
  };

  /** 檢查一個網址；from＝來源檔案相對路徑；severityMd＝.md 內的問題只算 warning */
  const check = (rawHref, from, where, { mdSource = false } = {}) => {
    const href = decodeEntities(String(rawHref).trim());
    if (!href) return;
    counts.links++;
    if (SKIP_SCHEME.test(href) || EXCLUDE.some((re) => re.test(href))) { counts.skipped++; return; }
    if (href.includes('${') || href.includes('{{')) { issue(warnings, 'template-literal', from, href, { where }); return; }

    let abs = href;
    if (href.startsWith('//')) abs = `https:${href}`;
    let pathPart = null;
    if (/^https?:\/\//i.test(abs)) {
      if (siteOrigin && (abs === siteOrigin || abs.startsWith(`${siteOrigin}/`) || abs.startsWith(`${siteOrigin}?`) || abs.startsWith(`${siteOrigin}#`))) {
        pathPart = abs.slice(siteUrl.length) || '/';
      } else {
        counts.external++;
        const why = blacklistHit(abs);
        if (why) issue(mdSource ? warnings : errors, 'blacklisted', from, href, { where, why });
        let host = '';
        try { host = new URL(abs).hostname; } catch { issue(mdSource ? warnings : errors, 'bad-url', from, href, { where }); return; }
        const e = external.get(abs) ?? { url: abs, host, count: 0, sources: new Set() };
        e.count++; if (e.sources.size < maxSources) e.sources.add(`/${from}`);
        external.set(abs, e);
        return;
      }
    } else if (OTHER_SCHEME.test(href)) { counts.skipped++; return; }

    counts.internal++;
    // 404.html 會在任意路徑下被回應，相對路徑會解析錯 ⇒ 一律要求以 / 開頭（或絕對網址）
    if (from === '404.html' && !pathPart && !href.startsWith('/') && !href.startsWith('#')) { issue(errors, 'relative-in-404', from, href, { where }); return; }
    const pageUrl = pageUrlOf(from, basePath);
    let u;
    try { u = new URL(pathPart ?? href, `http://local${pageUrl}`); } catch { issue(mdSource ? warnings : errors, 'bad-url', from, href, { where }); return; }
    let p = u.pathname;
    const frag = safeDecode(u.hash.replace(/^#/, ''));
    if (basePath) {
      if (p === basePath) p = `${basePath}/`;
      if (!p.startsWith(`${basePath}/`)) { issue(mdSource ? warnings : errors, 'missing-basepath', from, href, { where, target: p }); return; }
      p = p.slice(basePath.length);
    }
    const target = resolveFile(p);
    if (!target) { issue(mdSource ? warnings : errors, 'missing', from, href, { where, target: p }); return; }
    counts.internalOk++;
    if (frag && !FRAGMENT_SKIP.test(frag) && target.endsWith('.html')) {
      counts.anchorsChecked++;
      if (!idsOf(target).has(frag)) issue(warnings, 'missing-anchor', from, href, { where, target: `/${target}`, anchor: frag });
    }
  };

  for (const rel of htmlFiles) {
    const raw = readHtml(rel);
    const lang = langOf(rel);
    counts.byLang[lang] = (counts.byLang[lang] ?? 0) + 1;
    // JSON-LD
    for (const m of raw.matchAll(LDJSON_RE)) {
      let data;
      try { data = JSON.parse(m[1]); } catch { issue(warnings, 'bad-jsonld', rel, '(JSON-LD)'); continue; }
      const visit = (v) => {
        if (Array.isArray(v)) { v.forEach(visit); return; }
        if (!v || typeof v !== 'object') return;
        for (const [k, x] of Object.entries(v)) {
          if ((k === 'url' || k === 'contentUrl') && typeof x === 'string') check(x, rel, `jsonld.${k}`);
          else if (typeof x === 'object') visit(x);
        }
      };
      visit(data);
    }
    const body = raw.replace(STRIP_RE, '');
    for (const m of body.matchAll(ATTR_RE)) {
      const attr = m[1].toLowerCase();
      const val = m[2] ?? m[3] ?? '';
      if (attr === 'srcset') { for (const part of decodeEntities(val).split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) check(u, rel, 'srcset'); } continue; }
      check(val, rel, attr);
    }
    for (const m of body.matchAll(META_IMG_RE)) {
      const c = m[0].match(CONTENT_RE);
      if (c) check(c[1] ?? c[2] ?? '', rel, 'og:image');
    }
  }
  for (const rel of mdFiles) {
    const raw = fs.readFileSync(path.join(distDir, rel), 'utf8');
    for (const m of raw.matchAll(MD_LINK_RE)) check(m[1], rel, 'md', { mdSource: true });
  }

  counts.errors = errors.length;
  counts.warnings = warnings.length;
  counts.ms = Date.now() - t0;

  const byHost = new Map();
  for (const e of external.values()) {
    const h = byHost.get(e.host) ?? { domain: e.host, count: 0, urls: [] };
    h.count += e.count;
    h.urls.push({ url: e.url, count: e.count, sources: [...e.sources] });
    byHost.set(e.host, h);
  }
  const externalReport = {
    note: '建置時收集的外部連結（不在建置時驗證；CI 以 scripts/fetch-data.mjs --check-links 做 HEAD 檢查）。sources 只列前幾個來源頁。',
    totalLinks: counts.external,
    uniqueUrls: external.size,
    domains: [...byHost.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
      .map((h) => ({ ...h, urls: h.urls.sort((a, b) => b.count - a.count || a.url.localeCompare(b.url)) })),
  };
  // 依目標彙整（同一個壞連結常出現在上百頁）
  const errorsByTarget = {};
  // 依目標彙整後的排序：次數多的在前
  for (const e of errors) { const k = `${e.kind} ${e.target ?? e.href}`; (errorsByTarget[k] ??= { kind: e.kind, href: e.href, target: e.target ?? null, why: e.why, count: 0, firstFrom: e.from }).count++; }
  const report = {
    basePath, siteOrigin, ok: errors.length === 0, counts,
    rules: {
      internal: '資料夾型需有 index.html、檔案型需存在；?query 忽略；#anchor 缺 id ⇒ warning；不在 basePath 底下 ⇒ error',
      excluded: ['/ask/?q=', 'mailto:', 'tel:', 'sms:', 'javascript:', 'data:', 'blob:'],
      blacklist: BLACKLIST.map((b) => String(b.re)),
    },
    errorsByTarget: Object.values(errorsByTarget).sort((a, b) => b.count - a.count),
    errors: errors.slice(0, 5000),
    warnings: warnings.slice(0, 5000),
  };
  if (opts.write !== false) {
    const gov = path.join(distDir, 'v1/governance');
    fs.mkdirSync(gov, { recursive: true });
    fs.writeFileSync(path.join(gov, 'link-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(gov, 'external-links.json'), `${JSON.stringify(externalReport, null, 2)}\n`);
  }
  return { ok: errors.length === 0, errors, warnings, counts, external: externalReport, errorsByTarget: report.errorsByTarget };
}

/** console 摘要；回傳文字行（測試可用） */
export function summarize(res, { limit = 50, log = console.log } = {}) {
  const c = res.counts;
  log(`[links] ${c.pages} 頁、${c.links} 個連結：站內 ${c.internal}（通 ${c.internalOk}）、外部 ${c.external}（${res.external.domains.length} 個網域）、略過 ${c.skipped}；錨點檢查 ${c.anchorsChecked}；${c.ms} ms`);
  log(`[links] error ${c.errors}、warning ${c.warnings}${Object.keys(c.byKind).length ? `（${Object.entries(c.byKind).map(([k, v]) => `${k} ${v}`).join('、')}）` : ''}`);
  if (res.errors.length) {
    const byT = res.errorsByTarget ?? [];
    log(`[links] 壞連結（${byT.length} 種目標，依出現次數列前 ${Math.min(limit, byT.length)} 種；來源頁 → 目標）：`);
    for (const e of byT.slice(0, limit)) log(`  ✗ ${e.firstFrom} → ${e.href}${e.target && e.target !== e.href ? `（${e.target}）` : ''} [${e.kind}${e.why ? `：${e.why}` : ''}]${e.count > 1 ? ` ×${e.count}` : ''}`);
  }
  const anchors = res.warnings.filter((w) => w.kind === 'missing-anchor');
  if (anchors.length) {
    const uniq = new Map();
    for (const w of anchors) { const k = `${w.target}#${w.anchor}`; if (!uniq.has(k)) uniq.set(k, w); }
    log(`[links] 錨點找不到（warning，${anchors.length} 處／${uniq.size} 種，前 ${Math.min(limit, uniq.size)} 種）：`);
    for (const w of [...uniq.values()].slice(0, limit)) log(`  △ ${w.from} → ${w.href}`);
  }
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { config } = await import('../../site.config.mjs');
  const argv = process.argv.slice(2);
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dist = path.resolve(argv.find((a) => !a.startsWith('--')) ?? process.env.DIST_DIR ?? path.join(ROOT, 'dist'));
  const res = checkInternalLinks(dist, { basePath: config.basePath, langs: config.langs, siteUrl: config.siteUrl, md: argv.includes('--md') });
  summarize(res);
  if (!res.ok && (argv.includes('--check') || process.env.CI)) process.exit(1);
}
