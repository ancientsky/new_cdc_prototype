#!/usr/bin/env node
// 電子報週摘要產生器（第二十八輪，Issue #38）。
// 用法：node scripts/newsletter-digest.mjs [--today=YYYY-MM-DD] [--days=7] [--lang=zh-TW|en] [--topics=news,situation] [--out=資料夾] [--subscribers] [--origin=http://localhost:4173]
//
// 它做什麼：讀「與網站 RSS 完全同一份」資料（scripts/lib/feed-catalog.mjs → emit-seo.mjs 的 buildFeeds），挑出最近 N 天的新項目，
// 依主題分組，產生週摘要信的主旨、純文字與 HTML 內文。這樣正式的寄信服務只需要「寄」：不必也不該自己再去撈內容、排版。
//
// 兩種輸出：
//   預設（範本）  → 一封含合併欄位 {{manage_url}}、{{unsubscribe_url}} 的範本：digest-{日期}-{語言}.{txt,html}，交給寄信服務逐人替換。
//   --subscribers → 讀本機模擬後端的 .local/subscriptions.json，對每位「已確認＋每週摘要」的訂閱者，依其主題與語言各產生一封 .eml
//                   （含各自的退訂 token、List-Unsubscribe／List-Unsubscribe-Post 標頭）寫進 outbox，等同「模擬寄出」。
// 不會連網、不會真的寄信。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../site.config.mjs';
import { loadSite, ROOT } from './lib/load.mjs';
import { applyGovernance } from './lib/governance.mjs';
import { feedCatalog } from './lib/feed-catalog.mjs';
import { todayISO } from './lib/render.mjs';
import { buildEml, writeEml } from './lib/mail-outbox.mjs';
import { readSubscriptions, linksFor, listHeaders, DEFAULT_OUTBOX } from './lib/subscribe-mock.mjs';
import { composeDigest, mailText, TOPIC_IDS } from '../src/client/subscribe-rules.js';

const PER_TOPIC = 8;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** 期間內（from..to 含）的項目，依主題分組、日期新到舊，每主題最多 PER_TOPIC 筆。回傳 { from, to, items:[{topic,title,link,date,summary}] } */
export function collectDigestItems(site, { today, days = 7, topics = TOPIC_IDS } = {}) {
  const to = today;
  const from = addDays(today, -(days - 1));
  const items = [];
  for (const feed of feedCatalog(site)) {
    if (!topics.includes(feed.id)) continue;
    feed.items
      .filter((it) => it.date >= from && it.date <= to)
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
      .slice(0, PER_TOPIC)
      .forEach((it) => items.push({ topic: feed.id, title: it.title, link: it.link, date: it.date, summary: it.description }));
  }
  return { from, to, items };
}

/** 週摘要信（範本或個人化）。links 省略＝範本（合併欄位） */
export function buildDigest(site, { today, days = 7, topics = TOPIC_IDS, lang = 'zh-TW', links } = {}) {
  const { from, to, items } = collectDigestItems(site, { today, days, topics });
  const mail = composeDigest({ lang, from, to, items, links: links ?? { manageUrl: '{{manage_url}}', unsubscribeUrl: '{{unsubscribe_url}}' }, siteUrl: `${config.siteUrl}${config.basePath}${lang === 'en' ? '/en' : ''}/subscribe/` });
  return { ...mail, from, to, itemCount: items.length };
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = typeof args.today === 'string' ? args.today : (process.env.BUILD_TODAY || todayISO());
  const days = Math.min(31, Math.max(1, Number(args.days) || 7));
  const lang = args.lang === 'en' ? 'en' : 'zh-TW';
  const topics = typeof args.topics === 'string' ? args.topics.split(',').filter((x) => TOPIC_IDS.includes(x)) : TOPIC_IDS;
  const outDir = path.resolve(typeof args.out === 'string' ? args.out : process.env.OUTBOX_DIR || DEFAULT_OUTBOX);
  const origin = String(typeof args.origin === 'string' ? args.origin : process.env.PUBLIC_ORIGIN || 'http://localhost:4173').replace(/\/$/, '');

  const site = loadSite(config);
  site.today = today;
  site.now = process.env.BUILD_NOW ? new Date(process.env.BUILD_NOW).getTime() : Date.now();
  applyGovernance(site);

  if (args.subscribers) {
    const subs = readSubscriptions(process.env.SUBSCRIPTIONS_FILE || path.join(ROOT, '.local', 'subscriptions.json')).subscriptions
      .filter((s) => s.status === 'confirmed' && s.frequency === 'weekly');
    let sent = 0;
    for (const s of subs) {
      const links = linksFor(s, origin);
      const d = buildDigest(site, { today, days, topics: s.topics, lang: s.lang, links });
      if (!d.itemCount) continue; // 沒有新內容就不寄（不寄空信）
      const eml = buildEml({ fromName: mailText(s.lang).from, to: s.email, subject: d.subject, text: d.text, html: d.html, headers: { ...listHeaders(links.oneClickUrl), Precedence: 'bulk' } });
      console.log(`  → ${writeEml(outDir, 'digest', eml)}（${d.itemCount} 則）`);
      sent++;
    }
    console.log(`[digest] ${subs.length} 位每週摘要訂閱者，產生 ${sent} 封（無新內容者略過）→ ${outDir}`);
    return;
  }

  const d = buildDigest(site, { today, days, topics, lang });
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `digest-${d.to}-${lang}`);
  fs.writeFileSync(`${base}.txt`, `Subject: ${d.subject}\n\n${d.text}\n`);
  fs.writeFileSync(`${base}.html`, d.html);
  console.log(`[digest] ${d.from} – ${d.to}，${d.itemCount} 則，主題 ${topics.join(',')}`);
  console.log(`  主旨：${d.subject}\n  範本：${base}.txt、${base}.html（含 {{manage_url}}、{{unsubscribe_url}} 合併欄位，由寄信服務逐人替換）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
