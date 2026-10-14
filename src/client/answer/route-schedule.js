// 答案引擎分支：跨疫苗彙整（年齡／身分 × 疫苗接種時程主檔的結構化回答；「65 歲以上可以打哪些疫苗」）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('schedule') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { tr } from './lexicon.js';
import { ageHashOf, matchSchedule } from './structured.js';
import { bigrams } from './text.js';

export default function createScheduleRoute(ctx) {
  const { scheduleItems, units, vaccines, actionsFor, finalizeSentences, poolFor, relatedQuestions, sourceOf, todayRt } = ctx;

  // ── 跨疫苗彙整（結構化回答，不走檢索）：疫苗接種時程主檔 × 年齡／身分 ──
  // 句子由時程主檔欄位串接（dose、ageLabel、startAt、group），引用第一順位是「疫苗接種時程表」（grounding 比對對象），
  // 疫苗有頁面時第二順位引用該頁的接種對象片段（pf-N，依 group／年齡數字對應；找不到用 #v），讓使用者可點進疫苗頁。
  // verified=false：在句尾加「（待確認）」而不是只記 guards——時程數字直接出現在民眾看到的答案裡，
  // 承辦人尚未確認的數字應與時程地圖頁一樣明示；確認後（verified=true）字樣自動消失。
  const SCHED_ID = 'master.immunization-schedule';
  const SCHED_OWNER = 'unit.acute-infectious';
  function vaccineNameOf(vid, it) {
    const v = vaccines.find((x) => x.id === vid);
    if (v?.name || v?.title) return v.name ?? v.title;
    const m = String(it?.label ?? '').match(/^(.*?(?:疫苗|卡介苗))/);
    return m ? m[1].replace(/\s+$/, '') : (it?.label ?? vid);
  }
  function startPhrase(it, T) {
    if (!it.startAt) return '';
    const s = Date.parse(it.startAt), t = Date.parse(T);
    if (!Number.isFinite(s) || !Number.isFinite(t)) return '';
    // 只標示一年內（或尚未開始）的開打日；多年前開始的常規項目不再提起
    if (t - s > 365 * 86400000) return '';
    const [y, mo, d] = it.startAt.split('-').map(Number);
    return `${y} 年 ${mo} 月 ${d} 日起`;
  }
  function schedulePageChunk(vid, it, pool) {
    const pfs = pool.filter((c) => c.contentId === vid && /#pf-\d+$/.test(c.id));
    const want = new Set(bigrams(`${it.group ?? ''}${it.ageLabel ?? ''}${it.dose ?? ''}`.replace(/\s+/g, '')));
    const nums = (s) => new Set(String(s ?? '').match(/\d+/g) ?? []);
    const itNums = nums(`${it.group ?? ''} ${it.ageLabel ?? ''}`);
    let best = null, bestScore = 0;
    for (const c of pfs) {
      const have = new Set(bigrams(String(c.text ?? '').replace(/\s+/g, '')));
      let n = 0; for (const b of want) if (have.has(b)) n++;
      let s = n / Math.max(1, want.size);
      if (c.group && it.group && c.group === it.group) s += 1;
      const cNums = nums(c.group ?? c.text);
      if (itNums.size && [...itNums].every((x) => cNums.has(x))) s += 0.3;
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best && bestScore >= 0.2) return best;
    return pool.find((c) => c.id === `${vid}#v`) ?? null;
  }
  function scheduleAnswer(q, result, entities, profile) {
    if (!scheduleItems.length) return null;
    const LL = result.lang;
    const T = todayRt();
    const matched = matchSchedule(scheduleItems, profile, { today: T });
    const pool = poolFor('public', 'zh-TW').chunks;
    const P = profile.label || tr('zh-TW', '此年齡', '');
    const unv = (its) => (its.some((i) => i.verified === false) ? '（待確認）' : '');
    const uniq = (xs) => [...new Set(xs.filter(Boolean))];
    // 一疫苗一組：第一個項目的 effFunded 即該疫苗的最佳公費等級（matchSchedule 已依 funded 排序）
    const groups = new Map();
    for (const it of matched) {
      if (!groups.has(it.vaccine)) groups.set(it.vaccine, { vid: it.vaccine, funded: it.effFunded, items: [] });
      const g = groups.get(it.vaccine);
      if (it.effFunded === g.funded) g.items.push(it);
    }
    const all = [...groups.values()];
    const pub = all.filter((g) => g.funded === 'public');
    const cond = all.filter((g) => g.funded === 'conditional');
    const self = all.filter((g) => g.funded === 'self');
    const picked = []; const pages = new Map();
    const pushFor = (g, text) => {
      const page = schedulePageChunk(g.vid, g.items[0], pool);
      if (page) pages.set(page.id, page);
      picked.push({ text, cite: [SCHED_ID, ...(page ? [page.id] : [])], scheduleIds: g.items.map((i) => i.id), href: page ? null : `/vaccines/schedule/#${g.items[0].id}` });
    };
    const details = (it) => [it.dose, it.ageLabel, startPhrase(it, T)].filter(Boolean).join('，');
    // 第三十七輪：8 → 12。「2 歲前」整段有 10 種公費疫苗，原本只列 8 種、A 肝與日本腦炎被收進「另有 2 種」，家長看不到完整清單
    const PUB_MAX = 12;
    for (const g of pub.slice(0, PUB_MAX)) pushFor(g, `${P}公費疫苗：${vaccineNameOf(g.vid, g.items[0])}（${g.items.map(details).join('；')}）${unv(g.items)}。`);
    if (pub.length > PUB_MAX) picked.push({ text: `另有 ${pub.length - PUB_MAX} 種公費疫苗，請看完整疫苗時程地圖。`, cite: [SCHED_ID] });
    if (!pub.length) {
      // 沒有任何公費項目：明說，並提示下一次公費接種的時間點（只看不限身分的常規公費項目）
      const nextPub = profile.maxMonths == null ? [] : scheduleItems
        .filter((i) => i.funded === 'public' && !['pregnancy', 'risk'].includes(i.stage) && !/(原住民|孕婦)/.test(i.group ?? '') && (i.ageMinMonths ?? 0) > profile.maxMonths && !(i.endAt && i.endAt < T))
        .sort((a, b) => a.ageMinMonths - b.ageMinMonths);
      const nexts = nextPub.filter((i) => i.ageMinMonths === nextPub[0]?.ageMinMonths);
      const nextTxt = nexts.length ? `；下一次公費接種為${nexts[0].ageLabel}（${uniq(nexts.map((i) => vaccineNameOf(i.vaccine, i))).join('、')}）` : '';
      picked.push({ text: `${P}目前沒有常規公費疫苗${nextTxt}${unv(nexts)}。`, cite: [SCHED_ID], scheduleIds: nexts.map((i) => i.id) });
    }
    for (const g of cond.slice(0, 3)) pushFor(g, `符合條件者公費：${vaccineNameOf(g.vid, g.items[0])}（${uniq(g.items.map((i) => i.group || i.ageLabel)).join('；')}；${g.items[0].dose}）${unv(g.items)}。`);
    if (self.length) {
      const list = self.slice(0, 4).map((g) => `${vaccineNameOf(g.vid, g.items[0])}（${[g.items[0].dose, g.items[0].ageLabel].filter(Boolean).join('，')}）`);
      const its = self.slice(0, 4).flatMap((g) => g.items);
      picked.push({ text: `自費可考慮：${list.join('、')}${unv(its)}。`, cite: [SCHED_ID], scheduleIds: its.map((i) => i.id) });
    }
    const schedSrc = {
      id: SCHED_ID, contentId: SCHED_ID, type: 'schedule', lang: 'zh-TW', title: '疫苗接種時程表', subject: P, url: '/vaccines/schedule/',
      owner: SCHED_OWNER, ownerName: units.find((u) => u.id === SCHED_OWNER)?.name ?? '急性傳染病組', reviewedAt: null, nextReviewAt: null, publishedAt: null,
      isCurrent: true, license: 'OGDL-1.0', mdUrl: null, basis: '疫苗接種時程主檔', verified: matched.every((i) => i.verified !== false),
    };
    const sourceMap = new Map([[SCHED_ID, schedSrc], ...[...pages.values()].map((c) => [c.id, sourceOf(c)])]);
    finalizeSentences(result, picked, sourceMap);
    // 結構化句放進 retrieved（第一順位引用），grounding 檢核可逐句比對；疫苗頁片段一併列出
    const texts = picked.map((p) => p.text);
    result.retrieved = [{ id: SCHED_ID, contentId: SCHED_ID, type: 'schedule', title: schedSrc.title, url: schedSrc.url, sentences: texts, text: texts.join(' ') }, ...pages.values()];
    result.schedule = {
      structured: true, source: SCHED_ID, profile, ageHash: ageHashOf(profile),
      items: matched.map((i) => ({ id: i.id, vaccine: i.vaccine, label: i.label, funded: i.effFunded, verified: i.verified !== false })),
      unverified: matched.filter((i) => i.verified === false).length,
    };
    if (LL !== 'zh-TW') result.translationNote = 'showing-source'; // 時程主檔只有中文正本
    result.confidence = 0.9;
    // 接種對象＝問句的年齡／身分本身（結構化比對），與通報時限回答相同視為完整
    result.completeness = { required: ['who'], covered: ['who'], missing: [], score: 1 };
    result.actions = actionsFor(result, entities, null);
    result.related = relatedQuestions(result);
    return result;
  }
  return { scheduleAnswer };
}
