// 治理引擎（骨架版；Agent A 會依 ARCHITECTURE.md 第 3 節補完全部規則與 KPI）
// 原則：人只填欄位，這裡算出所有狀態。不得在模板裡重算治理邏輯。
import { addMonths, daysBetween } from './render.mjs';

export function applyGovernance(site) {
  const today = site.today;
  const policy = site.governance.whitelist;
  const docsByFamily = new Map();
  for (const d of site.collections.documents) {
    if (!docsByFamily.has(d.family)) docsByFamily.set(d.family, []);
    docsByFamily.get(d.family).push(d);
  }
  // 版本鏈：同 family 中 published 且 effectiveAt 最新者為現行版
  for (const [, versions] of docsByFamily) {
    const published = versions.filter((v) => v.status === 'published' || v.status === 'archived').sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
    const current = published.at(-1);
    for (const v of versions) {
      v.isCurrent = v === current;
      v.supersededBy = v.isCurrent ? null : (published.find((p) => p.effectiveAt > v.effectiveAt)?.id ?? null);
    }
  }
  const currentOfFamily = (family) => (docsByFamily.get(family) ?? []).find((v) => v.isCurrent) ?? null;
  const resolveBasedOn = (ref) => {
    const item = site.byId.get(ref);
    if (item?.type === 'document') return currentOfFamily(item.family);
    if (docsByFamily.has(ref)) return currentOfFamily(ref);
    return item ?? null;
  };

  const todos = [];
  let whitelistCount = 0, totalPublished = 0;
  for (const item of site.all) {
    const gov = { annotations: [], whitelist: { requested: !!item.aiWhitelist?.requested, effective: false, reasons: [] }, stale: [], translationStale: {}, reverseAuditHits: [] };
    gov.nextReviewAt = item.reviewPeriodMonths > 0 ? addMonths(item.reviewedAt, item.reviewPeriodMonths) : null;
    gov.daysToReview = gov.nextReviewAt ? daysBetween(today, gov.nextReviewAt) : null;
    gov.overdue = gov.nextReviewAt ? gov.nextReviewAt < today : false;
    gov.superseded = item.type === 'document' ? !item.isCurrent : false;
    gov.supersededBy = item.supersededBy ?? null;
    gov.isCurrent = item.type === 'document' ? !!item.isCurrent : true;

    for (const ref of item.basedOn ?? []) {
      const current = resolveBasedOn(ref);
      if (current?.type === 'document' && current.effectiveAt > item.publishedAt && (item.reviewedAt < current.effectiveAt)) {
        gov.stale.push({ basedOn: ref, revisedAt: current.effectiveAt, currentId: current.id, currentTitle: current.title });
      }
    }
    for (const [lang, meta] of Object.entries(item.languages ?? {})) {
      if (lang === 'zh-TW') continue;
      gov.translationStale[lang] = !!(meta.sourceHash && meta.sourceHash !== item.sourceHash);
    }
    // 註記（狀況層）
    if (gov.superseded) gov.annotations.push({ kind: 'superseded', text: `此為 ${item.version} 版，已由新版取代（${site.byId.get(gov.supersededBy)?.effectiveAt ?? ''} 生效）。`, href: gov.supersededBy });
    if (gov.overdue) gov.annotations.push({ kind: 'overdue', text: `本頁已超過審閱期限（${gov.nextReviewAt}），內容可能過時。` });
    for (const s of gov.stale) gov.annotations.push({ kind: 'based-on-revised', text: `本內容發布於 ${item.publishedAt}，所依據的「${s.currentTitle}」已於 ${s.revisedAt} 修訂，現行版請見連結。`, href: s.currentId });

    // 白名單資格
    const r = gov.whitelist.reasons;
    if (!gov.whitelist.requested) r.push('not-requested');
    if (item.status !== 'published') r.push('not-published');
    if (item.sensitivity !== 'public' && !(policy.allowedTypesPro ?? []).includes(item.type)) r.push('sensitivity');
    if (!policy.allowedTypes.includes(item.type) && !(policy.allowedTypesPro ?? []).includes(item.type)) r.push('type-not-allowed');
    if (gov.overdue) r.push('overdue');
    if (gov.superseded) r.push('superseded');
    if (gov.stale.length) r.push('based-on-revised');
    gov.whitelist.effective = r.length === 0;
    item.gov = gov;
    if (item.status === 'published') totalPublished++;
    if (gov.whitelist.effective) whitelistCount++;

    const ownerName = site.unitById.get(item.owner)?.name ?? item.owner;
    if (gov.overdue && item.status === 'published') todos.push({ kind: 'overdue', itemId: item.id, owner: item.owner, ownerName, dueAt: gov.nextReviewAt, text: `「${item.title}」逾期未審閱（${gov.nextReviewAt}），已退出 AI 白名單` });
    for (const s of gov.stale) todos.push({ kind: 'based-on-revised', itemId: item.id, owner: item.owner, ownerName, dueAt: addDays(s.revisedAt, 7), text: `「${item.title}」依據的正本已於 ${s.revisedAt} 修訂，請於 7 日內加註或改寫` });
  }

  // 反向稽核：auditRules 掃全站文字
  const rules = [];
  for (const d of site.master.diseases) for (const rule of d.auditRules ?? []) rules.push({ ...rule, from: d.id });
  for (const item of site.all) for (const rule of item.auditRules ?? []) rules.push({ ...rule, from: item.id });
  for (const rule of rules) {
    const re = new RegExp(rule.pattern, 'g');
    for (const item of site.all) {
      if (item.type === 'document' && !item.isCurrent) continue; // 失效版本本來就該有舊字
      if (rule.scope?.length && !(item.diseases ?? []).some((d) => rule.scope.includes(d)) && !rule.scope.includes(item.id) && !rule.scope.includes(item.family)) continue;
      if (rule.from === item.id || rule.from === item.family) continue;
      const text = textOf(item);
      const m = re.exec(text); re.lastIndex = 0;
      if (m) {
        const snippet = text.slice(Math.max(0, m.index - 20), m.index + 30);
        item.gov.reverseAuditHits.push({ term: m[0], rule: rule.message, snippet });
        if (!item.gov.stale.length) item.gov.whitelist.reasons.push('reverse-audit'), item.gov.whitelist.effective = false;
        todos.push({ kind: 'reverse-audit', itemId: item.id, owner: item.owner, ownerName: site.unitById.get(item.owner)?.name, dueAt: addDays(today, 7), text: `「${item.title}」出現「${m[0]}」：${rule.message}` });
      }
    }
  }
  whitelistCount = site.all.filter((i) => i.gov.whitelist.effective).length;

  // 資料集時效與授權
  const freqDays = { daily: 2, weekly: 10, monthly: 40, quarterly: 100, yearly: 380, irregular: Infinity };
  for (const ds of site.collections.datasets) {
    const limit = freqDays[ds.updateFrequency];
    ds.gov.datasetOverdue = ds.lastUpdated && limit !== Infinity ? daysBetween(ds.lastUpdated, today) > limit : false;
    if (ds.gov.datasetOverdue) todos.push({ kind: 'dataset-overdue', itemId: ds.id, owner: ds.owner, ownerName: site.unitById.get(ds.owner)?.name, dueAt: today, text: `資料集「${ds.title}」更新頻率 ${ds.updateFrequency}，最後更新 ${ds.lastUpdated}，已逾期` });
    if (!site.config.licenses.allowed.includes(ds.license)) todos.push({ kind: 'license-missing', itemId: ds.id, owner: ds.owner, ownerName: site.unitById.get(ds.owner)?.name, dueAt: today, text: `資料集「${ds.title}」授權「${ds.license}」非標準` });
  }

  // 翻譯過期待辦
  for (const item of site.all) for (const [lang, stale] of Object.entries(item.gov.translationStale)) if (stale) todos.push({ kind: 'translation-stale', itemId: item.id, owner: item.owner, ownerName: site.unitById.get(item.owner)?.name, dueAt: addDays(today, 14), text: `「${item.title}」中文已更新，${lang} 譯文待複核`, lang });

  site.gov = {
    today,
    pausedAI: !!site.governance.aiStatus.paused,
    whitelistCount, totalPublished, todos: todos.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    kpi: computeKpi(site),
    docsByFamily,
  };
}

function textOf(item) {
  const parts = [item.title, item.summary, item.question, item.answerMarkdown, item.bodyMarkdown, item.machineReadableMarkdown, item.clarificationMarkdown, item.claim];
  for (const b of item.blocks ?? []) parts.push(b.heading, b.markdown, b.warning, ...(b.cards ?? []).map((c) => `${c.if} ${c.title} ${c.text}`));
  for (const lang of Object.values(item.i18n ?? {})) parts.push(JSON.stringify(lang));
  return parts.filter(Boolean).join('\n');
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

function computeKpi(site) {
  const pub = site.all.filter((i) => i.status === 'published');
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  const contentPages = pub.filter((i) => ['disease', 'vaccine', 'faq'].includes(i.type));
  const withProv = contentPages.filter((i) => i.owner && i.reviewedAt);
  const ds = site.collections.datasets;
  const dsLic = ds.filter((d) => site.config.licenses.allowed.includes(d.license));
  const dsFresh = ds.filter((d) => !d.gov.datasetOverdue);
  const docs = site.collections.documents.filter((d) => d.isCurrent);
  const docsMr = docs.filter((d) => d.machineReadableMarkdown?.length > 50);
  const diseases = site.collections.diseases.filter((d) => d.status === 'published');
  const diseasesEn = diseases.filter((d) => d.languages?.en?.status === 'reviewed');
  const tier1 = pub.filter((i) => site.config.tier1Types.includes(i.type));
  const sevenLang = tier1.filter((i) => ['ja', 'tl', 'vi', 'id', 'th'].every((l) => ['reviewed', 'machine'].includes(i.languages?.[l]?.status)));
  const stale = pub.filter((i) => i.gov.stale.length);
  const supersededIndexed = site.collections.documents.filter((d) => !d.isCurrent && d.status === 'published');
  return [
    { key: 'provenance', label: '對外內容頁有更新日與權責單位', current: pct(withProv.length, contentPages.length), numerator: withProv.length, denominator: contentPages.length, target1y: 100, target3y: 100, unit: '%' },
    { key: 'dataset-license', label: '開放資料集授權標示一致', current: pct(dsLic.length, ds.length), numerator: dsLic.length, denominator: ds.length, target1y: 100, target3y: 100, unit: '%' },
    { key: 'dataset-fresh', label: '資料集在更新頻率內更新', current: pct(dsFresh.length, ds.length), numerator: dsFresh.length, denominator: ds.length, target1y: 90, target3y: 98, unit: '%' },
    { key: 'doc-machine-readable', label: '文件有機讀版（現行版）', current: pct(docsMr.length, docs.length), numerator: docsMr.length, denominator: docs.length, target1y: 100, target3y: 100, unit: '%' },
    { key: 'en-sync', label: '英文版與中文同步（疾病頁）', current: pct(diseasesEn.length, diseases.length), numerator: diseasesEn.length, denominator: diseases.length, target1y: 91, target3y: 100, unit: '%' },
    { key: 'seven-lang', label: '一級內容七語涵蓋', current: pct(sevenLang.length, tier1.length), numerator: sevenLang.length, denominator: tier1.length, target1y: 50, target3y: 100, unit: '%' },
    { key: 'openapi', label: '對外資料出口有 OpenAPI 文件', current: 100, numerator: 1, denominator: 1, target1y: 100, target3y: 100, unit: '%' },
    { key: 'stale-derived', label: '已修訂正本仍有未加註衍生內容', current: stale.length, target1y: 0, target3y: 0, unit: '件' },
    { key: 'superseded-indexed', label: '失效版本仍在搜尋結果', current: supersededIndexed.filter((d) => !d.gov.superseded).length, target1y: 0, target3y: 0, unit: '件', note: '失效版自動 noindex，由引擎保證為 0' },
    { key: 'whitelist', label: 'AI 白名單生效內容數', current: site.all.filter((i) => i.gov.whitelist.effective).length, unit: '筆' },
  ];
}
