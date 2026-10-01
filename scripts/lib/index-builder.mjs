// 答案單元索引（骨架版；Agent D 會補完切塊、詞彙展開、句子切分品質）
import { mdToText } from './markdown.mjs';

export function splitSentences(text) {
  return String(text).split(/(?<=[。！？!?；;])\s*|\n+/).map((s) => s.trim()).filter((s) => s.length >= 4);
}

function chunkOf(site, item, key, title, text, url, extra = {}) {
  const sentences = splitSentences(text);
  if (!sentences.length) return null;
  const owner = site.unitById.get(item.owner);
  return {
    id: `${item.id}#${key}`, contentId: item.id, type: item.type, lang: extra.lang ?? 'zh-TW',
    title, text: sentences.join(' '), sentences, url,
    owner: item.owner, ownerName: owner?.name ?? item.owner, reviewedAt: item.reviewedAt, nextReviewAt: item.gov.nextReviewAt,
    audience: item.audience, tasks: item.tasks ?? [], diseases: item.diseases ?? [], vaccines: item.vaccines ?? [], countries: item.countries ?? [],
    version: item.version ?? null, effectiveAt: item.effectiveAt ?? null, isCurrent: item.gov.isCurrent, whitelist: item.gov.whitelist.effective,
    terms: Array.from(new Set([...(item.keywords ?? []), ...(item.aliases ?? []), item.title])).filter(Boolean),
    ...extra,
  };
}

export function buildSearchIndex(site) {
  const pub = [], pro = [];
  const push = (c) => { if (!c) return; if (c.audience.includes('public')) pub.push(c); if (c.audience.includes('professional') || c.type === 'document') pro.push(c); };
  for (const item of site.all) {
    if (!item.gov.whitelist.effective) continue;
    const base = (p) => p; // url 由 client 端加 basePath
    switch (item.type) {
      case 'disease':
        for (const b of item.blocks) {
          const text = [b.markdown ? mdToText(b.markdown) : '', b.warning ?? '', ...(b.cards ?? []).map((c) => `${c.if}${c.title}：${c.text}`)].join(' ');
          push(chunkOf(site, item, b.key, `${item.title} · ${b.heading}`, text, base(`/diseases/${item.slug}/#${b.key}`)));
        }
        push(chunkOf(site, item, 'keyfacts', `${item.title} · 一分鐘重點`, Object.entries(item.keyFacts).map(([k, v]) => `${labelOf(k)}：${v}。`).join(' '), base(`/diseases/${item.slug}/`)));
        break;
      case 'faq': push(chunkOf(site, item, 'a', item.question, mdToText(item.answerMarkdown), base(`/faq/${item.id.replace(/^faq\./, '')}/`))); break;
      case 'news': case 'letter': push(chunkOf(site, item, 'body', item.title, `${item.summary} ${mdToText(item.bodyMarkdown)}`, base(`/news/${item.id.replace(/^news\./, '')}/`))); break;
      case 'clarification': push(chunkOf(site, item, 'c', item.title, `${item.claim} ${mdToText(item.clarificationMarkdown)}`, base(`/factcheck/#${item.id}`), { verdict: item.verdict, claim: item.claim })); break;
      case 'document':
        for (const s of item.sections ?? []) push(chunkOf(site, item, s.key, `${item.title} · ${s.heading}`, mdToText(s.markdown), base(`/documents/${item.id.replace(/^doc\./, '')}/#${s.key}`)));
        if (!item.sections?.length) push(chunkOf(site, item, 'body', item.title, mdToText(item.machineReadableMarkdown), base(`/documents/${item.id.replace(/^doc\./, '')}/`)));
        break;
      case 'vaccine': push(chunkOf(site, item, 'v', item.title, `${mdToText(item.bodyMarkdown)} ${item.publicFunded.map((p) => `${p.group}：${p.schedule}${p.note ? `（${p.note}）` : ''}`).join(' ')}`, base(`/vaccines/${item.slug}/`))); break;
      default: break;
    }
  }
  return { public: pub, pro };
}

function labelOf(k) { return { incubation: '潛伏期', symptoms: '主要症狀', transmission: '傳染途徑', prevention: '預防', notify: '通報時限' }[k] ?? k; }
