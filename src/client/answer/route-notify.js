// 答案引擎分支：通報時限（傳染病主檔＋通報時限表的結構化回答；notify 意圖）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('notify') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { ownerNameOf, tr } from './lexicon.js';
import { PERSON } from './rules.js';
import { CAT_ZH, hoursPhrase, notifyHoursLabel } from './structured.js';
import { parseChineseNumber } from './text.js';

export default function createNotifyRoute(ctx) {
  const { diseaseById, diseases, notifyRows, units, finalizeSentences, relatedQuestions } = ctx;

  // ── 通報時限（結構化回答，不走檢索）：只讀傳染病主檔＋通報時限表 ──
  const NOTIFY_HOW_RE = /(怎麼|如何|流程|方式|哪裡|向誰|找誰|群聚)/;
  const NOTIFY_PERSONAL_RE = new RegExp(`${PERSON}.{0,10}(得了|得到|感染|確診|疑似|好像得|可能得)`);
  function masterSource(d, row, cat) {
    return {
      id: `master.diseases#${d ? d.id : `category-${cat}`}`, contentId: 'master.diseases', type: 'master', lang: 'zh-TW',
      title: '傳染病主檔 · 傳染病防治法公告', subject: d ? d.name : `第${CAT_ZH[cat] ?? cat}類法定傳染病`, basis: '傳染病防治法公告',
      url: `/report/#category-${cat}`, owner: d?.owner ?? 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, d?.owner ?? 'unit.epidemic-intelligence'),
      reviewedAt: null, nextReviewAt: null, isCurrent: true, license: 'OGDL-1.0', mdUrl: null,
      legalCategory: cat, notifyWithinHours: d?.notifyWithinHours ?? null, hoursLabel: d ? notifyHoursLabel(d.notifyWithinHours) : null,
      caseDefinitionUrl: row?.caseDefinitionPath ?? null, labtestUrl: row?.labtestPath ?? null, diseaseUrl: row?.path ?? (d && (d.hasPage || d.page) ? `/diseases/${d.slug}/` : null),
    };
  }
  function notifyAnswer(q, result, entities) {
    const LL = result.lang;
    const picked = []; const sources = []; const items = [];
    const ds = entities.diseases.filter((x) => !x.derived).map((x) => diseaseById.get(x.id)).filter((d) => d && d.legalCategory != null && d.notifyWithinHours != null);
    if (entities.diseases.some((x) => !x.derived) && !ds.length) return null; // 問的是非法定傳染病：交給檢索
    // 沒有疾病、問的是「怎麼通報／群聚通報流程」而非時限或類別 ⇒ 交給檢索（申請服務：群聚通報、法定傳染病通報）
    if (!ds.length && NOTIFY_HOW_RE.test(q) && !/(第\s*[一二三四五1-5]\s*類|幾類|哪一?類|時限|多久|幾小時|幾天)/.test(q)) return null;
    if (ds.length) {
      for (const d of ds.slice(0, 3)) {
        const cat = d.legalCategory; const row = notifyRows.get(d.id) ?? null;
        const src = masterSource(d, row, cat);
        const text = LL === 'zh-TW'
          ? `${d.name}${d.nameEn ? `（${d.nameEn}）` : ''}為第${CAT_ZH[cat] ?? cat}類法定傳染病，應於${hoursPhrase(d.notifyWithinHours)}通報。`
          : `${d.nameEn ?? d.name} is a Category ${cat} notifiable disease and must be reported within ${d.notifyWithinHours} hours.`;
        picked.push({ text, cite: [src.id] }); sources.push(src);
        items.push({ id: d.id, name: d.name, nameEn: d.nameEn ?? null, legalCategory: cat, categoryLabel: `第${CAT_ZH[cat] ?? cat}類`, notifyWithinHours: d.notifyWithinHours, hoursLabel: notifyHoursLabel(d.notifyWithinHours),
          caseDefinitionUrl: src.caseDefinitionUrl, labtestUrl: src.labtestUrl, diseaseUrl: src.diseaseUrl, reportUrl: src.url });
      }
    } else {
      const m = q.match(/第\s*([一二三四五1-5])\s*類/);
      const want = m ? (Number(m[1]) || parseChineseNumber(m[1])) : null;
      const byCat = new Map();
      for (const d of diseases) if (d.legalCategory != null && d.notifyWithinHours != null) { if (!byCat.has(d.legalCategory)) byCat.set(d.legalCategory, []); byCat.get(d.legalCategory).push(d); }
      const cats = [...byCat.keys()].sort((a, b) => a - b).filter((c) => want == null || c === want);
      if (!cats.length) return null;
      for (const cat of cats) {
        const list = byCat.get(cat);
        const counts = new Map(); for (const d of list) counts.set(d.notifyWithinHours, (counts.get(d.notifyWithinHours) ?? 0) + 1);
        const [h0] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        const examples = list.filter((d) => d.notifyWithinHours === h0).slice(0, 3).map((d) => d.name).join('、');
        const others = [...counts.keys()].filter((h) => h !== h0).sort((a, b) => a - b).map((h) => {
          const names = list.filter((d) => d.notifyWithinHours === h).map((d) => d.name);
          return `${names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')}等 ${names.length} 種`}應於${hoursPhrase(h)}通報`;
        });
        const src = masterSource(null, null, cat);
        const text = `第${CAT_ZH[cat] ?? cat}類法定傳染病（主檔共 ${list.length} 種，如${examples}）${others.length ? '多數' : ''}應於${hoursPhrase(h0)}通報${others.length ? `；其中${others.join('，')}` : ''}。`;
        picked.push({ text, cite: [src.id] }); sources.push(src);
        items.push({ id: null, name: `第${CAT_ZH[cat] ?? cat}類法定傳染病`, legalCategory: cat, categoryLabel: `第${CAT_ZH[cat] ?? cat}類`, notifyWithinHours: h0, hoursLabel: notifyHoursLabel(h0), count: list.length, reportUrl: src.url });
      }
    }
    const sourceMap = new Map(sources.map((x) => [x.id, x]));
    finalizeSentences(result, picked, sourceMap);
    // 結構化片段也放進 retrieved，讓 grounding 檢核可逐句比對
    result.retrieved = sources.map((x) => { const sents = picked.filter((p) => p.cite[0] === x.id).map((p) => p.text); return { id: x.id, contentId: x.contentId, type: 'master', title: x.title, url: x.url, sentences: sents, text: sents.join(' ') }; });
    const personal = NOTIFY_PERSONAL_RE.test(q);
    result.notify = {
      items, structured: true, source: 'master.diseases', basis: '傳染病防治法公告', personal,
      note: result.view === 'pro' ? null : tr(LL, '法定傳染病由診治醫師依規定通報；民眾發現疑似病例或群聚，請撥打 1922 防疫專線。', 'Notifiable diseases are reported by the attending physician. If you suspect a case or cluster, call the 1922 hotline.'),
    };
    result.confidence = 0.95;
    result.completeness = { required: ['category', 'hours'], covered: ['category', 'hours'], missing: [], score: 1 };
    const a = [];
    if (personal || result.view !== 'pro') a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    const it = items[0];
    a.push({ label: tr(LL, '前往通報專區', 'Reporting'), href: it?.reportUrl ?? '/report/', kind: 'link' });
    if (it?.caseDefinitionUrl) a.push({ label: tr(LL, `${it.name}病例定義`, `Case definition: ${it.nameEn ?? it.name}`), href: it.caseDefinitionUrl, kind: 'link' });
    if (it?.labtestUrl) a.push({ label: tr(LL, `${it.name}檢驗項目`, `Lab tests: ${it.nameEn ?? it.name}`), href: it.labtestUrl, kind: 'link' });
    if (it?.diseaseUrl && a.length < 4) a.push({ label: tr(LL, `看${it.name}完整頁面`, `${it.nameEn ?? it.name}: full page`), href: it.diseaseUrl, kind: 'link' });
    if (!a.some((x) => x.href === 'tel:1922')) a.push({ label: tr(LL, '撥打 1922', 'Call 1922'), href: 'tel:1922', kind: 'hotline' });
    result.actions = a.slice(0, 4);
    result.related = relatedQuestions(result);
    return result;
  }
  return { notifyAnswer };
}
