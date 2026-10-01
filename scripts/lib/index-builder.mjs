// 答案單元索引（ARCHITECTURE.md 5.1）
// 把白名單內容切成「答案單元」→ v1/search-index.json（民眾）與 v1/search-index-pro.json（專業）。
//
// 切塊規則：
//   disease   八區塊各一塊（有文字者）＋ 一分鐘重點 ＋ 「我該怎麼辦」if 卡各一塊 ＋ 專業欄位（只進專業索引）
//   faq       問＋答一塊
//   news      段落切塊（每段 ≤ 300 字）；letter（致醫界通函）只進專業索引
//   document  sections 每段一塊（section 條號／標題、version、effectiveAt、family、supersedes、本段異動）；只進專業索引
//   clarification  一塊（含 verdict、claim）
//   vaccine   本文一塊 ＋ 公費對象每組一塊
//   dataset   series 不入索引（走統計問答）
// 保證：失效版本（superseded）、逾期、依據正本已修訂（stale）的內容永遠不在索引。
// 多語：i18n[lang] 有 reviewed（且譯文未過期）者另出同語 chunk；machine 一律不出。
import { splitPlain } from '../../src/client/answer/core.js';

const MAX_PARA = 300;

/** Markdown → 句子陣列（保留清單項目邊界；不吃連字號） */
export function mdSentences(markdown) {
  if (!markdown) return [];
  const lines = String(markdown)
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\n/)
    .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/\*\*|__|`/g, '').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2').replace(/^\|.*\|$/, (row) => row.replace(/\|/g, ' ').replace(/[-:]{3,}/g, ' ')).trim())
    .filter(Boolean);
  return lines.flatMap((l) => splitPlain(l));
}

/** 相容舊 API：純文字句切 */
export function splitSentences(text) { return splitPlain(text); }

/** 段落切塊：依空行分段；超過 300 字依句子再切 */
export function paragraphs(markdown, max = MAX_PARA) {
  const out = [];
  for (const para of String(markdown ?? '').split(/\n\s*\n/)) {
    const sents = mdSentences(para);
    let cur = [];
    let len = 0;
    for (const s of sents) {
      if (len + s.length > max && cur.length) { out.push(cur); cur = []; len = 0; }
      cur.push(s); len += s.length;
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

function glossaryHits(site, text) {
  const hits = [];
  for (const g of site.master.glossary ?? []) {
    for (const w of [g['zh-TW'], ...(g.aliases ?? [])].filter(Boolean)) if (w.length >= 2 && text.includes(w)) { hits.push(g['zh-TW'], w); break; }
  }
  return hits;
}

function diseaseNames(site, ids) {
  const out = [];
  for (const id of ids ?? []) { const d = site.diseaseMasterById.get(id); if (d) out.push(d.name, ...(d.aliases ?? []).filter((a) => a.length >= 2)); }
  return out;
}

/** 路徑（與 governance.pathOf 一致；避免相依順序時自備一份） */
function pathOf(item) {
  const slug = String(item.id).replace(/^[a-z]+\./, '');
  switch (item.type) {
    case 'disease': return `/diseases/${item.slug ?? slug}/`;
    case 'vaccine': return `/vaccines/${item.slug ?? slug}/`;
    case 'faq': return `/faq/${slug}/`;
    case 'news': case 'letter': return `/news/${slug}/`;
    case 'document': return `/documents/${slug}/`;
    case 'clarification': return `/factcheck/#${item.id}`;
    default: return '/';
  }
}

function sectionNo(s) {
  if (s.no != null) return String(s.no);
  const m = `${s.heading ?? ''} ${s.key ?? ''}`.match(/第\s*([\d一二三四五六七八九十]+)\s*[條點章節]|^(?:art|sec|s)?-?(\d+)$/i);
  return m ? (m[1] ?? m[2]) : null;
}

export function buildSearchIndex(site) {
  const pub = [], pro = [];
  const today = site.today;
  const langsOf = (item) => Object.entries(item.languages ?? {}).filter(([l, m]) => l !== 'zh-TW' && m?.status === 'reviewed' && !item.gov?.translationStale?.[l] && item.i18n?.[l]).map(([l]) => l);

  function make(item, key, title, sentences, url, extra = {}) {
    const sents = (sentences ?? []).map((s) => String(s).trim()).filter((s) => s.length >= 4);
    if (!sents.length) return null;
    const unit = site.unitById.get(item.owner);
    const text = sents.join(' ');
    const lang = extra.lang ?? 'zh-TW';
    const terms = Array.from(new Set([
      ...(item.keywords ?? []), ...(item.aliases ?? []), ...diseaseNames(site, item.diseases), ...glossaryHits(site, `${title} ${text}`),
      ...(extra.extraTerms ?? []),
    ].filter((t) => t && String(t).length >= 2)));
    delete extra.extraTerms;
    return {
      id: `${item.id}#${key}${lang !== 'zh-TW' ? `@${lang}` : ''}`, contentId: item.id, type: item.type, lang,
      title, text, sentences: sents, url, summary: extra.summary ?? item.summary ?? null,
      owner: item.owner, ownerName: unit?.name ?? item.owner, reviewedAt: item.reviewedAt, nextReviewAt: item.gov?.nextReviewAt ?? null, publishedAt: item.publishedAt ?? null,
      audience: item.audience ?? [], tasks: item.tasks ?? [], diseases: item.diseases ?? [], vaccines: item.vaccines ?? [], countries: item.countries ?? [],
      version: item.version ?? null, effectiveAt: item.effectiveAt ?? null, family: item.family ?? null, supersedes: item.supersedes ?? null,
      isCurrent: item.gov?.isCurrent !== false, whitelist: !!item.gov?.whitelist?.effective, license: item.license ?? 'OGDL-1.0',
      mdUrl: url.startsWith('/factcheck') ? null : `${url.replace(/#.*$/, '').replace(/\/$/, '')}.md`,
      legacyUrl: item.legacyUrls?.[0] ?? null,
      terms,
      ...extra,
    };
  }

  function eligiblePublic(item) {
    const g = item.gov; if (!g) return false;
    if (['document', 'letter'].includes(item.type)) return false; // 文件庫、通函只供專業版（whitelist.tier = pro）
    if (typeof g.whitelist?.public === 'boolean') return g.whitelist.public; // 治理引擎算好的民眾白名單
    return !!g.whitelist?.effective && (item.audience ?? []).includes('public');
  }
  function eligiblePro(item) {
    const g = item.gov; if (!g) return false;
    if (g.superseded || g.isCurrent === false || g.overdue || (g.stale?.length ?? 0) > 0 || g.predatesBasis) return false;
    if (item.status !== 'published') return false;
    if (g.whitelist?.effective) return true;
    return ['document', 'letter'].includes(item.type) && item.sensitivity === 'public' && g.isCurrent !== false && !(g.reverseAuditHits?.length);
  }

  for (const item of site.all) {
    const toPub = eligiblePublic(item);
    const toPro = eligiblePro(item);
    if (!toPub && !toPro) continue;
    const out = [];
    const base = pathOf(item);
    const add = (c, { proOnly = false } = {}) => { if (c) out.push({ c, proOnly }); };

    // 譯文只取 i18n[lang] 本身的欄位（不 fallback 中文，避免中文句子被標成外語 chunk）
    const variants = [{ lang: 'zh-TW', src: item }, ...langsOf(item).map((l) => ({ lang: l, src: { title: item.i18n[l].title ?? item.nameEn ?? item.title, ...item.i18n[l] } }))];
    for (const { lang, src } of variants) {
      const L = { lang };
      switch (item.type) {
        case 'disease': {
          const blocks = src.blocks ?? [];
          for (const b of blocks) {
            const zhBlock = (item.blocks ?? []).find((x) => x.key === b.key) ?? b;
            if (lang !== 'zh-TW' && !b.markdown && !b.warning && !b.cards?.length) continue;
            const warnLabel = { 'zh-TW': '警示徵象：', en: 'Warning signs: ', vi: 'Dấu hiệu cảnh báo: ' }[lang] ?? '';
            const sents = [...mdSentences(b.markdown), ...(b.warning ? splitPlain(`${warnLabel}${b.warning}`) : [])];
            add(make(item, b.key, `${src.title ?? item.title} · ${b.heading ?? zhBlock.heading}`, sents, `${base}#${b.key}`, { ...L, block: b.key }));
            (b.cards ?? []).forEach((card, i) => {
              const pre = { 'zh-TW': '如果', en: 'If you ', vi: 'Nếu ' }[lang] ?? '';
              const sent = [card.if ? `${pre}${card.if}${lang === 'zh-TW' ? '：' : ': '}${card.title}${lang === 'zh-TW' ? '。' : '.'}` : null, ...splitPlain(card.text)].filter(Boolean);
              add(make(item, `${b.key}#card-${i + 1}`, `${src.title ?? item.title} · ${card.title}`, sent, `${base}#${b.key}`, { ...L, block: b.key, card: { if: card.if, title: card.title } }));
            });
          }
          const kf = src.keyFacts ?? {};
          const label = lang === 'zh-TW' ? { incubation: '潛伏期', symptoms: '主要症狀', transmission: '傳染途徑', prevention: '預防', treatment: '治療', notify: '通報時限' } : { incubation: 'Incubation', symptoms: 'Symptoms', transmission: 'Transmission', prevention: 'Prevention', treatment: 'Treatment', notify: 'Notification' };
          add(make(item, 'keyfacts', `${src.title ?? item.title} · ${lang === 'zh-TW' ? '一分鐘重點' : 'Key facts'}`, Object.entries(kf).map(([k, v]) => `${src.title ?? item.title}${lang === 'zh-TW' ? '' : ' — '}${label[k] ?? k}${lang === 'zh-TW' ? '：' : ': '}${v}${lang === 'zh-TW' ? '。' : '.'}`), base, { ...L, block: 'keyfacts' }));
          if (lang === 'zh-TW' && item.professional) {
            const p = item.professional;
            const sents = [p.notifyNote, p.specimen ? `檢體：${p.specimen}` : null, p.caseDefinition ? `病例定義：${p.caseDefinition}` : null].filter(Boolean).flatMap((x) => splitPlain(x));
            add(make(item, 'professional', `${item.title} · 專業人員重點`, sents, `${base}#professional`, { ...L, block: 'professional', audience: ['professional'] }), { proOnly: true });
          }
          break;
        }
        case 'faq':
          add(make(item, 'a', src.question ?? item.question ?? item.title, mdSentences(src.answerMarkdown ?? ''), base, { ...L, question: src.question ?? item.question, extraTerms: [src.question ?? item.question] }));
          break;
        case 'news': case 'letter': {
          const paras = paragraphs(src.bodyMarkdown ?? '');
          paras.forEach((p, i) => add(make(item, `p${i + 1}`, src.title ?? item.title, p, base, { ...L, newsType: item.newsType ?? null, letterNo: item.letterNo ?? null }), { proOnly: item.type === 'letter' }));
          break;
        }
        case 'document': {
          if (lang !== 'zh-TW' && !src.sections) break;
          const prev = item.supersedes ? site.byId.get(item.supersedes) : null;
          const secs = src.sections?.length ? src.sections : [{ key: 'body', heading: src.title ?? item.title, markdown: src.machineReadableMarkdown ?? '' }];
          for (const s of secs) {
            const no = sectionNo(s);
            const change = (item.changes ?? []).find((ch) => ch.section === s.heading || ch.section === s.key || (no && String(ch.section).includes(`第 ${no} 條`)) || (no && String(ch.section).includes(`第${no}條`))) ?? null;
            add(make(item, s.key, `${src.title ?? item.title} · ${s.heading}`, mdSentences(s.markdown), `${base}#${s.key}`, {
              ...L, docTitle: src.title ?? item.title, docType: item.docType ?? null,
              section: { key: s.key, heading: s.heading, no }, supersedesVersion: prev?.version ?? null,
              change: change ? { kind: change.kind ?? null, before: change.before ?? null, after: change.after ?? null } : null,
            }), { proOnly: true });
          }
          break;
        }
        case 'clarification':
          add(make(item, 'c', src.title ?? item.title, [...mdSentences(src.clarificationMarkdown ?? ''), ...(src.shareText ? splitPlain(src.shareText) : [])], base, { ...L, verdict: item.gov?.stale?.length ? 'outdated' : item.verdict, claim: item.claim, extraTerms: [item.claim, ...(item.claimVariants ?? [])] }));
          break;
        case 'vaccine': {
          add(make(item, 'v', src.title ?? item.title, mdSentences(src.bodyMarkdown ?? ''), base, { ...L }));
          const groups = src.publicFunded ?? [];
          groups.forEach((g, i) => {
            if (g.endAt && today && g.endAt < today) return; // 已結束的公費期間不入索引
            const when = g.startAt || g.endAt ? `（${g.startAt ?? ''}${g.endAt ? ` 至 ${g.endAt}` : ' 起'}）` : '';
            // 句型只做欄位串接，不加「公費」字樣（自費族群也可能列在 publicFunded，由 note 說明）
            const sent = lang === 'zh-TW' ? `${item.title}接種對象：${g.group}，${g.schedule}${g.note ? `（${g.note}）` : ''}${when}。` : `${src.title ?? item.title} — ${g.group}: ${g.schedule}${g.note ? ` (${g.note})` : ''}.`;
            add(make(item, `pf-${i + 1}`, `${src.title ?? item.title} · ${lang === 'zh-TW' ? '接種對象與時程' : 'Who and when'}`, [sent], `${base}#public-funded`, { ...L, group: g.group }));
          });
          if (lang === 'zh-TW' && item.precautions) add(make(item, 'precautions', `${item.title} · 注意事項`, mdSentences(item.precautions), `${base}#precautions`, { ...L }));
          break;
        }
        default: break;
      }
    }
    for (const { c, proOnly } of out) {
      if (toPub && !proOnly) pub.push(c);
      if (toPro) pro.push(c);
    }
  }

  // 防呆：唯一 id
  const dedupe = (arr) => { const seen = new Set(); return arr.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))); };
  const P = dedupe(pub), R = dedupe(pro);
  const byType = {};
  for (const c of P) byType[c.type] = (byType[c.type] ?? 0) + 1;
  const byLang = {};
  for (const c of [...P, ...R]) byLang[c.lang] = (byLang[c.lang] ?? 0) + 1;
  const result = { public: P, pro: R };
  Object.defineProperty(result, 'stats', { value: { chunks: P.length, chunksPro: R.length, byType, byLang }, enumerable: true });
  return result;
}
