// /play/<slug>/ 的互動（第六十二輪）：兒童衛教小測驗、防疫決策模擬、歷史上的今天「真正的今天」。
// 原則：
//   - 漸進增強：頁面已有純文字版（<details>）；本檔載入後才把它藏起來、換成一題一題／一回合一回合的互動。沒有 JS 一樣能讀完。
//   - 所有文字用 textContent／建節點，不把內容塞進 innerHTML（內容雖來自站內 JSON，仍照全站規則）。
//   - 鍵盤可用：選項是 <button>；焦點在換題後移到新題目的標題；結果區 aria-live。沒有動畫，不需要 prefers-reduced-motion 例外。
//   - 介面字串用 CDC.t（建置時拆出的 i18n.<lang>.js；本檔出現的 key 會被收進去）。
const T = (k, v) => (window.CDC?.t ? window.CDC.t(k, v) : k);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = String(v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v)); }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
};
const readJson = (sel, root = document) => { try { return JSON.parse(root.querySelector(sel)?.textContent ?? 'null'); } catch { return null; } };
const basedOn = (b) => (b?.href ? el('a', { class: 'c-play__based', href: b.href, text: `${T('play.basedOn')}：${b.title}` }) : null);

/* ───── 兒童衛教小測驗 ───── */
function initQuiz(root) {
  const data = readJson('[data-quiz-data]', root);
  const stage = root.querySelector('[data-quiz-stage]');
  const fallback = root.querySelector('[data-quiz-fallback]');
  if (!Array.isArray(data) || !data.length || !stage) return;
  fallback.hidden = true; stage.hidden = false;
  // 選項順序每次洗牌（題目資料裡正確答案固定在某個位置，洗牌後孩子不能用位置背答案）
  const shuffle = (arr) => { const a = arr.map((v, i) => ({ v, i, r: Math.random() })); a.sort((x, y) => x.r - y.r); return a; };
  let idx = 0, score = 0;
  const live = el('p', { class: 'c-quiz__live', role: 'status', 'aria-live': 'polite' });
  const show = () => {
    stage.replaceChildren();
    if (idx >= data.length) {
      const ratio = score / data.length;
      const msg = ratio >= 0.8 ? T('quiz.done.high') : ratio >= 0.5 ? T('quiz.done.mid') : T('quiz.done.low');
      const h = el('h2', { class: 'c-quiz__h', tabindex: '-1', text: T('quiz.score', { n: score, total: data.length }) });
      stage.append(h, el('p', { class: 'c-quiz__msg', text: msg }), el('button', { type: 'button', class: 'c-btn', text: T('play.again') }));
      stage.querySelector('button').addEventListener('click', () => { idx = 0; score = 0; show(); });
      h.focus();
      return;
    }
    const q = data[idx];
    const h = el('h2', { class: 'c-quiz__h', tabindex: '-1' }, el('span', { class: 'c-quiz__n', text: T('quiz.q', { i: idx + 1 }) }), ' ', q.emoji ? `${q.emoji} ` : '', q.q);
    const list = el('div', { class: 'c-quiz__btns', role: 'group', 'aria-label': q.q });
    const result = el('div', { class: 'c-quiz__result', hidden: true });
    const btns = shuffle(q.choices).map(({ v, i }) => {
      const b = el('button', { type: 'button', class: 'c-quiz__choice', 'data-i': i, text: v });
      b.addEventListener('click', () => {
        const ok = i === q.answer;
        if (ok) score++;
        for (const x of list.querySelectorAll('button')) { x.disabled = true; if (Number(x.dataset.i) === q.answer) x.classList.add('is-answer'); }
        b.classList.add(ok ? 'is-right' : 'is-wrong');
        result.hidden = false;
        result.replaceChildren(el('p', { class: `c-quiz__verdict ${ok ? 'is-right' : 'is-wrong'}`, text: ok ? T('quiz.correct') : T('quiz.wrong', { a: q.choices[q.answer] }) }), el('p', { class: 'c-quiz__explain', text: q.explain }), basedOn({ title: q.basedOnTitle, href: q.basedOnHref }), el('p', {}, el('button', { type: 'button', class: 'c-btn c-btn--sm', text: idx + 1 >= data.length ? T('quiz.score', { n: score, total: data.length }) : T('play.next') })));
        result.querySelector('.c-btn').addEventListener('click', () => { idx++; show(); });
        live.textContent = ok ? T('quiz.correct') : T('quiz.wrong', { a: q.choices[q.answer] });
        result.querySelector('.c-btn').focus();
      });
      return b;
    });
    list.append(...btns);
    stage.append(el('p', { class: 'c-quiz__progress', text: `${idx + 1} / ${data.length}` }), h, list, result, live);
    h.focus();
  };
  show();
}

/* ───── 防疫決策模擬 ───── */
function initSim(root) {
  const data = readJson('[data-sim-data]', root);
  const stage = root.querySelector('[data-sim-stage]');
  const fallback = root.querySelector('[data-sim-fallback]');
  if (!data?.rounds?.length || !stage) return;
  fallback.hidden = true; stage.hidden = false;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  let round = 0, values = Object.fromEntries(data.meters.map((m) => [m.key, m.start]));
  const meterBar = (m) => {
    const v = values[m.key];
    const good = m.lowerIsBetter ? v <= 35 : v >= 60;
    const bad = m.lowerIsBetter ? v >= 65 : v <= 35;
    const wrap = el('div', { class: `c-sim__meter ${good ? 'is-good' : bad ? 'is-bad' : ''}` });
    wrap.append(el('span', { class: 'c-sim__mlabel', text: `${m.label}：${v}` }));
    const bar = el('div', { class: 'c-sim__bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(v), 'aria-label': m.label });
    bar.append(el('span', { class: 'c-sim__fill', style: `width:${v}%` }));
    wrap.append(bar);
    return wrap;
  };
  const meters = () => el('div', { class: 'c-sim__meters', 'aria-label': T('sim.meters') }, data.meters.map(meterBar));
  const ending = () => {
    const match = (e) => Object.entries(e.when ?? {}).every(([k, c]) => (c.min == null || values[k] >= c.min) && (c.max == null || values[k] <= c.max));
    return (data.endings.find((e) => e.when && Object.keys(e.when).length && match(e)) ?? data.endings.find((e) => !e.when || !Object.keys(e.when).length) ?? data.endings[0]).text;
  };
  const show = () => {
    stage.replaceChildren();
    if (round >= data.rounds.length) {
      const h = el('h2', { class: 'c-sim__h', tabindex: '-1', text: T('sim.ending') });
      stage.append(h, meters(), el('p', { class: 'c-sim__ending', text: ending() }), el('button', { type: 'button', class: 'c-btn', text: T('play.again') }));
      stage.querySelector('button').addEventListener('click', () => { round = 0; values = Object.fromEntries(data.meters.map((m) => [m.key, m.start])); show(); });
      h.focus();
      return;
    }
    const r = data.rounds[round];
    const h = el('h2', { class: 'c-sim__h', tabindex: '-1' }, el('span', { class: 'c-sim__n', text: T('sim.round', { i: round + 1, total: data.rounds.length }) }), ' ', r.title);
    const opts = el('div', { class: 'c-sim__opts', role: 'group', 'aria-label': T('sim.choose') });
    const result = el('div', { class: 'c-sim__result', hidden: true, role: 'status', 'aria-live': 'polite' });
    for (const o of r.options) {
      const b = el('button', { type: 'button', class: 'c-sim__opt', text: o.label });
      b.addEventListener('click', () => {
        for (const x of opts.querySelectorAll('button')) x.disabled = true;
        b.classList.add('is-chosen');
        const deltas = Object.entries(o.effects ?? {}).map(([k, d]) => { values[k] = clamp(values[k] + d); return T('sim.change', { label: data.meters.find((m) => m.key === k)?.label ?? k, delta: `${d > 0 ? '+' : ''}${d}` }); });
        result.hidden = false;
        result.replaceChildren(el('p', { class: 'c-sim__feedback', text: o.feedback }), deltas.length ? el('p', { class: 'c-sim__deltas', text: deltas.join('　') }) : null, basedOn(o.basedOn), el('p', {}, el('button', { type: 'button', class: 'c-btn c-btn--sm', text: round + 1 >= data.rounds.length ? T('sim.ending') : T('play.next') })));
        stage.querySelector('.c-sim__meters').replaceWith(meters());
        result.querySelector('.c-btn').addEventListener('click', () => { round++; show(); });
        result.querySelector('.c-btn').focus();
      });
      opts.append(b);
    }
    stage.append(h, meters(), el('p', { class: 'c-sim__prompt', text: r.prompt }), opts, result);
    h.focus();
  };
  show();
}

/* ───── 歷史上的今天：建置時的 site.today 可能不是讀者的今天（主站每 2 小時重建、示範站凍結日期）→ 用瀏覽器日期重挑 ───── */
function initOtd(root) {
  const today = root.querySelector('[data-otd-today]');
  if (!today) return;
  const d = new Date();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (today.dataset.today === mmdd) return;
  const all = [...root.querySelectorAll('.c-otd__month [data-mmdd]')];
  if (!all.length) return;
  let pick = all.filter((li) => li.dataset.mmdd === mmdd);
  let exact = true;
  if (!pick.length) { exact = false; const next = all.find((li) => li.dataset.mmdd > mmdd) ?? all[0]; pick = all.filter((li) => li.dataset.mmdd === next.dataset.mmdd); }
  const list = today.querySelector('[data-otd-pick]');
  list.replaceChildren(...pick.map((li) => { const c = li.cloneNode(true); if (exact) c.querySelector('.c-otd__date')?.remove(); return c; }));
  const dateEl = today.querySelector('[data-otd-date]');
  if (dateEl) dateEl.textContent = exact ? '' : ` · ${T('otd.near', { date: pick[0].dataset.mmdd.replace('-', '/') })}`;
  today.dataset.today = mmdd;
}

const root = document.querySelector('[data-play-kind]');
if (root) {
  const kind = root.dataset.playKind;
  if (kind === 'kids-quiz') initQuiz(root);
  else if (kind === 'policy-sim') initSim(root);
  else if (kind === 'on-this-day') initOtd(root);
}
