// 答案引擎分支：旅遊疫情建議的近期變化（travel 意圖、沒指定國家、問「最近哪些國家解除／調升」）。
// 第四十九輪自 core.js 原封不動搬出（程式碼一字未改，git diff --color-moved 可對照），改成「問到這類問題才 import()」，
// 大多數問題（症狀、疫苗、出國、態勢…）不必下載這段程式；為什麼這樣拆、拆了什麼、沒拆什麼，見 docs/ask-search-llm.md §14。
// 由 core.js createEngine 內的 route('travel-changes') 建立：ctx 是同一個引擎閉包裡的狀態與共用函式（不是另一份引擎），所以行為與搬出前完全相同。
import { ownerNameOf } from './lexicon.js';
import { TRAVEL_CHANGE_KINDS, TRAVEL_CHANGE_RE } from './rules.js';

export default function createTravelChangesRoute(ctx) {
  const { travelItems, today, now, units } = ctx;

  // ── 旅遊疫情建議的變化（近 30 天新增／調升／調降／解除；資料為等級表各國 RecentChanges） ──
  const KIND_ZH = { new: '新增', raised: '調升', lowered: '調降', lifted: '解除', renewed: '重新發布' };
  const KIND_EN = { new: 'new', raised: 'raised', lowered: 'lowered', lifted: 'lifted', renewed: 'renewed' };
  function travelChanges(q, lang, days = 30) {
    if (!TRAVEL_CHANGE_RE.test(q)) return null;
    const rows = travelItems.filter((t) => t.aggregate);
    // 新格式等級表（有 Targeted*）一律附事件快照推得的 RecentChanges（無變化的國家不帶此欄）；舊快照沒有變化資料 ⇒ 不回答
    if (!rows.length || !rows.some((r) => Array.isArray(r.recentChanges) || r.targetedLevel != null)) return null;
    const asOf = today ?? now().toISOString().slice(0, 10);
    const since = new Date(Date.parse(`${asOf}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
    const all = rows.flatMap((r) => (r.recentChanges ?? []).map((c) => ({ ...c, iso2: r.iso2, name: r.name }))).filter((e) => e.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
    const recent = all.filter((e) => e.date >= since);
    const asked = Object.entries(TRAVEL_CHANGE_KINDS).filter(([, re]) => re.test(q)).map(([k]) => k);
    const kinds = asked.length ? asked : ['lifted', 'raised', 'lowered', 'new'];
    const id = 'travel#changes';
    const src = { id, contentId: 'travel.changes', type: 'travel', title: '旅遊疫情建議 · 近期變化', url: '/travel/', owner: 'unit.epidemic-intelligence', ownerName: ownerNameOf(units, 'unit.epidemic-intelligence'), reviewedAt: all[0]?.date ?? null, isCurrent: true, license: 'OGDL-1.0', lang: 'zh-TW' };
    const zh = lang === 'zh-TW';
    const fmt = (e) => `${e.name}${e.Disease ? `（${e.Disease}${e.Area ? `，${e.Area}` : ''}，${e.date}）` : `（${e.date}）`}`;
    const sents = [];
    for (const k of kinds) {
      const hits = recent.filter((e) => e.kind === k);
      if (hits.length) sents.push({ text: zh ? `近 ${days} 天${KIND_ZH[k]}旅遊疫情建議的有：${hits.slice(0, 8).map(fmt).join('、')}${hits.length > 8 ? ` 等 ${hits.length} 則` : ''}。` : `Travel notices ${KIND_EN[k]} in the last ${days} days: ${hits.slice(0, 8).map((e) => `${e.name} (${e.Disease}, ${e.date})`).join('; ')}.`, cite: [id], slot: 0, score: 9 });
      else if (asked.length) {
        const older = all.filter((e) => e.kind === k);
        sents.push({ text: zh ? `近 ${days} 天（${since} 起）沒有${KIND_ZH[k]}的旅遊疫情建議${older.length ? `；較早一則為${fmt(older[0])}` : ''}。` : `No travel notices ${KIND_EN[k]} in the last ${days} days (since ${since}).`, cite: [id], slot: 0, score: 9 });
      }
    }
    const n = (k) => recent.filter((e) => e.kind === k).length;
    sents.push({ text: zh ? `近 ${days} 天變化：新增 ${n('new')}、調升 ${n('raised')}、調降 ${n('lowered')}、解除 ${n('lifted')}；各國現行等級請查目的地。` : `Last ${days} days: ${n('new')} new, ${n('raised')} raised, ${n('lowered')} lowered, ${n('lifted')} lifted.`, cite: [id], slot: 0, score: 8 });
    return { sentences: sents, sources: new Map([[id, src]]) };
  }
  return { travelChanges };
}
