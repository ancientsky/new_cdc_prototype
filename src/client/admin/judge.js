// 評估判分（與 eval/run-eval.mjs 的 judge 同一規則，瀏覽器版）。若答案引擎自己匯出 judge 會優先使用。
export function judge(q, res) {
  const e = q.expect ?? {};
  const reasons = [];
  if (e.refuse === true && !res.refused) reasons.push('應拒答但回答了');
  if (e.refuse === false && res.refused) reasons.push('不應拒答卻拒答');
  if (e.intent && res.intent !== e.intent) reasons.push(`意圖 ${res.intent} ≠ ${e.intent}`);
  const cites = (res.sources ?? []).map((s) => s.contentId);
  for (const m of e.mustCite ?? []) if (!cites.some((c) => c?.startsWith(m))) reasons.push(`未引用 ${m}`);
  for (const m of e.mustNotCite ?? []) if (cites.some((c) => c?.startsWith(m))) reasons.push(`引用了禁止來源 ${m}（失效版本）`);
  const text = `${(res.sentences ?? []).map((s) => s.text).join(' ')} ${res.refusal?.text ?? ''} ${res.verdict ?? ''}`;
  for (const m of e.mustInclude ?? []) if (!text.includes(m)) reasons.push(`答案未包含「${m}」`);
  for (const m of e.mustNotInclude ?? []) if (text.includes(m)) reasons.push(`答案包含禁止字「${m}」`);
  if (e.verdict && res.verdict !== e.verdict) reasons.push(`判定 ${res.verdict} ≠ ${e.verdict}`);
  if (e.disease && res.disease !== e.disease) reasons.push(`疾病 ${res.disease} ≠ ${e.disease}`);
  for (const s of res.sentences ?? []) if (!s.cite?.length) reasons.push(`grounding：句子無來源「${String(s.text).slice(0, 20)}」`);
  return reasons;
}
