// 結構化型別的欄位抽取（第十一輪／第四批）：publication、media、dataset、labtest、service、clarification。
// 原則：舊頁能看出來的就填（表格列、清單項、連結、嵌入影片 id、標題關鍵字），看不出來的填「（待補：…）」佔位並記 fields-pending 警告，
// 讓草稿先過 schema、進報告供人比對，而不是以 page／news 暫存再請人改型別。
const CLAR_WORDS = ['網傳', '謠言', '澄清', '不實', '錯誤訊息', '假訊息'];

export const STRUCTURED_TYPES = new Set(['publication', 'media', 'dataset', 'labtest', 'service', 'clarification']);
export const PENDING = (what) => `（待補：${what}）`;

/** Markdown 表格 → [{cells:[...]}]（跳過分隔列） */
export function mdTableRows(md) {
  const rows = [];
  for (const line of String(md ?? '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|?\s*:?-{2,}/.test(t)) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

/** 兩欄「項目｜內容」表 → Map(項目 → 內容) */
export function kvTable(md) {
  const m = new Map();
  for (const cells of mdTableRows(md)) if (cells.length >= 2 && cells[0] && !m.has(cells[0])) m.set(cells[0], cells[1]);
  return m;
}

export const listItems = (md) => String(md ?? '').split('\n').map((l) => /^\s*(?:[-*]|\d+[.)、])\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);
export const mdLinks = (md) => [...String(md ?? '').matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => ({ label: m[1], href: m[2] }));
const strip = (s) => String(s ?? '').replace(/\*\*/g, '').trim();
const dash = (v) => !v || /^[—\-–]+$/.test(strip(v));

export function pubTypeFor(title, mapTo) {
  if (mapTo?.pubType) return { pubType: mapTo.pubType, clear: true };
  const t = String(title);
  if (/海報|單張|摺頁|貼紙/.test(t)) return { pubType: 'poster', clear: true };
  if (/手冊/.test(t)) return { pubType: 'manual', clear: true };
  if (/年報/.test(t)) return { pubType: 'annual-report', clear: true };
  if (/統計/.test(t)) return { pubType: 'statistics', clear: true };
  if (/影音|多媒體|光碟/.test(t)) return { pubType: 'multimedia', clear: true };
  if (/週報|疫情報導|通訊|期刊/.test(t)) return { pubType: 'bulletin', clear: true };
  return { pubType: 'book', clear: false };
}

export function clarificationClaim(title) {
  const q = /[「『“"]([^」』”"]{4,})[」』”"]/.exec(title);
  if (q) return q[1];
  let t = String(title);
  for (const w of CLAR_WORDS) t = t.replace(new RegExp(`^${w}[：:]?`), '');
  return t.replace(/(說法|傳言)?(不實|沒有科學根據|非事實|是錯的|為假|係屬錯誤|請勿轉傳|勿信)[，。！]?$/, '').trim() || String(title);
}

export function verdictFor(title, md) {
  const t = `${title}\n${String(md ?? '').slice(0, 400)}`;
  if (/過時|舊版|已修訂|已更新|不再適用/.test(t)) return { verdict: 'outdated', clear: true };
  if (/部分正確|部分屬實|半真半假/.test(t)) return { verdict: 'partly-true', clear: true };
  if (/屬實|確有其事|正確無誤/.test(t) && !/不實|非事實/.test(t)) return { verdict: 'true', clear: true };
  if (/不實|沒有科學根據|無科學根據|非事實|錯誤|謠言|假訊息|誤導/.test(t)) return { verdict: 'false', clear: true };
  return { verdict: 'false', clear: false };
}

/**
 * 依型別抽欄位。
 * @returns {{ fields: object, pending: string[], notes: string[] }} pending＝填了佔位的欄位名；notes＝其他提示
 */
export function extractFields(kind, ctx) {
  const { title, markdown: md, mapTo, dm, pageUrl, publishedAt, updatedAt, exportedAt, media = [], assets = [], draftId, professional, short, rules } = ctx;
  const pending = [];
  const notes = [];
  const kv = kvTable(md);
  const pdfs = assets.filter((a) => a.kind === 'attachment' && /\.pdf$/i.test(a.file));
  const data = assets.filter((a) => a.kind === 'data');
  const href = (a) => `/files/${draftId}/${a.file}`;

  if (kind === 'publication') {
    const pt = pubTypeFor(title, mapTo);
    if (!pt.clear) notes.push('標題看不出出版品種類，pubType 暫填 book');
    const series = pt.pubType === 'poster' ? `${dm?.name ?? ''}宣導素材`.trim() : ctx.category?.split('／').at(-1) || `${dm?.name ?? ''}出版品`;
    const fields = { pubType: pt.pubType, series, abstractMarkdown: md };
    if (pdfs[0]) fields.pdfUrl = href(pdfs[0]); else { pending.push('pdfUrl'); }
    return { fields, pending, notes };
  }
  if (kind === 'media') {
    const yt = media.map((m) => /(?:youtube\.com\/embed\/|youtu\.be\/|v=)([\w-]{6,})/.exec(m.src ?? '')?.[1]).find(Boolean) ?? null;
    const mediaType = Array.isArray(mapTo?.mediaType) ? mapTo.mediaType[0] : mapTo?.mediaType ?? (/動畫/.test(title) ? 'animation' : /podcast|廣播/i.test(title) ? 'podcast' : /短片|短影音/.test(title) ? 'short' : 'video');
    let transcript = String(md ?? '').trim();
    const tsec = /#{2,4}\s*影片文字稿\s*\n+([\s\S]+)$/.exec(transcript);
    if (tsec) transcript = tsec[1].trim();
    if (transcript.length < 40) { transcript = PENDING('舊頁沒有文字稿，請由影片字幕或腳本補入'); pending.push('transcriptMarkdown'); }
    if (!yt) { notes.push('舊頁沒有可辨識的 YouTube 嵌入，youtubeId 填 null'); }
    if (yt === 'xxxxxxxxxxx') notes.push('模擬匯出的影片 id 為示意值');
    return { fields: { mediaType, youtubeId: yt, producedAt: publishedAt, transcriptMarkdown: transcript, captions: ['zh-TW'] }, pending, notes };
  }
  if (kind === 'dataset') {
    const open = mdLinks(md).find((l) => /data\.cdc\.gov\.tw|data\.gov\.tw|nidss\.cdc\.gov\.tw/.test(l.href));
    const t = `${title}\n${md}`;
    const updateFrequency = /每日|日報/.test(t) ? 'daily' : /每週|週報|周報/.test(t) ? 'weekly' : /每月|月報/.test(t) ? 'monthly' : /每季|季報/.test(t) ? 'quarterly' : /年度|每年|年報/.test(t) ? 'yearly' : 'irregular';
    if (updateFrequency === 'irregular') notes.push('看不出更新頻率，updateFrequency 暫填 irregular');
    const fields = {
      category: data.length ? 'structured-table' : open ? 'open-dataset' : 'content-page',
      canonicalUrl: open?.href ?? pageUrl, updateFrequency, lastUpdated: updatedAt ?? publishedAt,
      formats: [...new Set(data.map((a) => a.file.split('.').pop().toUpperCase()))],
      ...(open ? { portalUrl: open.href } : {}),
      resources: data.map((a) => ({ label: a.label ?? a.file, href: href(a), format: a.file.split('.').pop().toUpperCase() })),
      provenance: { mode: 'snapshot', fetchedAt: exportedAt, sourceUrl: pageUrl },
    };
    if (!open && !data.length) { notes.push('舊頁沒有資料檔也沒有開放資料連結，canonicalUrl 暫填舊頁網址'); pending.push('canonicalUrl'); }
    return { fields, pending, notes };
  }
  if (kind === 'labtest') {
    const specRow = [...kv.entries()].find(([k]) => /檢體/.test(k))?.[1];
    const names = dash(specRow) ? [] : strip(specRow).split(/[、，,／/;；]/).map((s) => s.trim()).filter(Boolean);
    const P = PENDING('舊頁未載明，依採檢手冊補');
    const specimens = (names.length ? names : [PENDING('舊頁未載明檢體種類')]).map((name) => ({ name, container: P, volume: P, storage: P, transport: P }));
    pending.push('specimens[].container/volume/storage/transport');
    if (!names.length) pending.push('specimens[].name');
    const hrsRow = [...kv.entries()].find(([k]) => /時限|時效/.test(k))?.[1];
    const hrs = /(\d+)\s*小時/.exec(strip(hrsRow ?? ''))?.[1];
    const bsl = [...kv.entries()].find(([k]) => /生物安全/.test(k))?.[1];
    const fields = { disease: dm?.id ?? PENDING('疾病'), specimens, labs: ['cdc-lab'], notesMarkdown: md };
    if (hrs) fields.sendWithinHours = Number(hrs); else pending.push('sendWithinHours');
    if (!dash(bsl)) fields.biosafetyLevel = strip(bsl);
    notes.push('labs 暫填 cdc-lab（署檢驗中心），合約與區域實驗室請檢驗中心確認');
    return { fields, pending, notes };
  }
  if (kind === 'service') {
    const st = serviceTypeFor(rules, title) ?? { serviceType: 'other', clear: false };
    if (!st.clear) notes.push('標題看不出服務種類，serviceType 暫填 other');
    const items = listItems(md).filter((x) => !/^\[.*\]\(.*\)$/.test(x));
    const steps = items.length ? items.slice(0, 8).map((x) => ({ title: strip(x).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 60) })) : [{ title: PENDING('舊頁是查詢清單，請補申辦或查詢步驟') }];
    if (!items.length) pending.push('steps');
    const whoCanApply = professional ? ['醫療院所'] : ['民眾'];
    pending.push('whoCanApply');
    const fields = { slug: String(draftId).replace(/^[a-z]+\./, ''), serviceType: st.serviceType, whoCanApply, introMarkdown: md, steps };
    if (pdfs.length || data.length) fields.forms = [...pdfs, ...data].map((a) => ({ label: a.label ?? a.file, href: href(a), format: a.file.split('.').pop().toUpperCase(), machineReadable: a.kind === 'data' }));
    if (st.serviceType === 'clinic') notes.push('合約院所名單屬時效性資料，建議掛 dataset 由系統更新，不要把名單寫進內文');
    return { fields, pending, notes };
  }
  if (kind === 'clarification') {
    const claim = clarificationClaim(title);
    const v = verdictFor(title, md);
    if (!v.clear) notes.push('標題與內文看不出判定，verdict 暫填 false，請公關室確認');
    const share = ctx.summary ?? '';
    return { fields: { claim, verdict: v.verdict, clarificationMarkdown: md, shareText: share.length > 10 ? share : `${claim}：${v.verdict === 'false' ? '不正確' : v.verdict === 'outdated' ? '已過時' : v.verdict === 'partly-true' ? '部分正確' : '正確'}，詳見疾管署說明。`, reportChannel: '1922' }, pending, notes };
  }
  return { fields: {}, pending, notes };
}

/** 標題關鍵字 → 服務種類（規則檔 serviceRules：[{ keys, serviceType }]） */
export function serviceTypeFor(rules, title) {
  for (const r of rules?.serviceRules ?? []) if ((r.keys ?? []).some((k) => String(title).includes(k))) return { serviceType: r.serviceType, clear: true };
  return null;
}

/** 新站 id 前綴 → 型別（clar. 是 clarification） */
export const TYPE_BY_PREFIX = { clar: 'clarification', doc: 'document', faq: 'faq', news: 'news', page: 'page', disease: 'disease', media: 'media', dataset: 'dataset', labtest: 'labtest', service: 'service', publication: 'publication', vaccine: 'vaccine', topic: 'topic' };
export const typeOfId = (id) => TYPE_BY_PREFIX[String(id ?? '').split('.')[0]] ?? String(id ?? '').split('.')[0];
