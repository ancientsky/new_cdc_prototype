// RSS 摘要頻道目錄（第二十八輪，Issue #38）：從 emit-seo.mjs 的 buildFeeds() 實際輸出「讀回來」，而不是再手抄一份清單。
//
// 為什麼讀回 XML 而不是另外維護陣列：訂閱頁、Email 主題清單、週摘要三處都要知道「有哪些頻道、網址、最近有什麼」。
// 手抄一份遲早與 emit-seo 不同步（某天新增 feeds/xxx.xml，訂閱頁卻沒列）；從輸出讀回就永遠一致。
// tests/round28-newsletter.test.mjs 另外保證 TOPIC_IDS（src/client/subscribe-rules.js）＝這裡的頻道 id，新增頻道卻忘了加主題會測試失敗。
import { buildFeeds, absUrl } from './emit-seo.mjs';

const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? unesc(m[1]) : ''; };
const tagAll = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => unesc(m[1]));

/** 解析本站 RSS 2.0（只吃 emit-seo 的 rss() 產生的格式） */
export function parseRss(xml) {
  const [head] = xml.split('<item>');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const x = m[1];
    const pub = new Date(tag(x, 'pubDate'));
    return { title: tag(x, 'title'), link: tag(x, 'link'), guid: tag(x, 'guid'), date: Number.isNaN(+pub) ? '' : new Date(+pub + 8 * 3600 * 1000).toISOString().slice(0, 10) /* 台灣日期：RSS 的 pubDate 是 UTC，日期型內容為台灣當日 00:00＝UTC 前一日 16:00 */, categories: tagAll(x, 'category'), description: tag(x, 'description') };
  });
  return { title: tag(head, 'title'), link: tag(head, 'link'), description: tag(head, 'description'), items };
}

const cache = new WeakMap();
/**
 * 頻道目錄：[{ id, file:'feeds/news.xml', url(絕對), title, description, link, count, items:[{title,link,guid,date,categories,description}] }]
 * 順序同 buildFeeds()。以 site 物件快取（七語各渲染一次訂閱頁，只算一次）。
 */
export function feedCatalog(site) {
  if (cache.has(site)) return cache.get(site);
  const out = Object.entries(buildFeeds(site)).map(([file, xml]) => {
    const p = parseRss(xml);
    return { id: file.replace(/^feeds\//, '').replace(/\.xml$/, ''), file, url: absUrl(`/${file}`), title: p.title, description: p.description, link: p.link, count: p.items.length, items: p.items };
  });
  cache.set(site, out);
  return out;
}
