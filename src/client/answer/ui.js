// 搜尋即答案頁（/ask/）：掛到 C 的殼 #ask-form／#ask-q、#answer、#answer-side、#ask-advanced、#llm-key。
// 流程：讀 ?q= → core（抽取式）→ 依意圖渲染 wireframe 第 3 頁區塊 →（有 key 且啟用）LLM 重組或翻譯 → 後檢 → 重新渲染。
import { loadEngine, currentView, url, esc, v1, LANG } from './data.js';
import { L, link, isLowRelevance, sentenceList, sourceList, disclosureRow, refusalCard, situationCards, verdictBlock, statsBlock, traditionalList, fullTextLink, wireInteractions, ensureStyles, notifyBlock, conflictNotes } from './render.js';
import './inline.js'; // 頁內問題框（#ask-inline／[data-ask-inline]）→ /ask/
import { getKey, setKey, getModel, setModel, llmModels, llmAnswer, llmTranslate, purgeLegacyKey, staffSessionActive } from './llm.js';

ensureStyles();
const answerEl = document.getElementById('answer');
const sideEl = document.getElementById('answer-side');
const form = document.getElementById('ask-form') ?? document.querySelector('form[role="search"]');
const input = document.getElementById('ask-q') ?? form?.querySelector('input[name="q"]');
const params = new URLSearchParams(location.search);
const view = currentView();
const pro = view === 'pro';
let current = null;
let runId = 0;
let lastQ = ''; // 目前這題的問句（全文搜尋連結用）

const LLM_ON_KEY = 'cdc.llmEnabled';
// 第二十三輪：LLM 模式只在「同事後台工作階段有效 ＋ 本分頁有 key」時啟用；開關也存 sessionStorage（跟 key 同生命週期）
const llmEnabled = () => { try { return staffSessionActive() && !!getKey() && sessionStorage.getItem(LLM_ON_KEY) !== '0'; } catch { return false; } };

if (answerEl) {
  answerEl.classList.add('ask-page');
  if (pro) document.documentElement.dataset.view = 'pro';
  wireInteractions(answerEl, () => current);
  setupAdvanced();
  if (input && params.get('q') && !input.value) input.value = params.get('q');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input?.value.trim() ?? '';
    const sp = new URLSearchParams(location.search);
    if (q) sp.set('q', q); else sp.delete('q');
    history.pushState({ q }, '', `${location.pathname}?${sp.toString()}`);
    run(q);
  });
  window.addEventListener('popstate', () => { const q = new URLSearchParams(location.search).get('q') ?? ''; if (input) input.value = q; run(q); });
  run(params.get('q') ?? '');
}

function busy(on, text = L('loading')) {
  answerEl.setAttribute('aria-busy', String(on));
  if (on) answerEl.innerHTML = `<div class="c-skeleton" aria-hidden="true"><span></span><span></span><span class="short"></span><span></span></div><p class="sr-only">${esc(text)}</p>`;
}

async function run(q) {
  const my = ++runId;
  lastQ = q;
  if (!q) {
    answerEl.setAttribute('aria-busy', 'false');
    answerEl.innerHTML = `<p class="muted">${esc(L('empty'))}</p>`;
    if (sideEl) sideEl.innerHTML = '';
    return;
  }
  busy(true);
  const { engine, deps } = await loadEngine(view);
  if (my !== runId) return;
  const disease = new URLSearchParams(location.search).get('disease') || null;
  let result = engine.answer(q, { lang: LANG, view, disease });
  current = result;
  await render(result, deps);
  renderSide(result, deps);
  // LLM（BYOK）：重組或翻譯；任何失敗都保留抽取式結果
  if (llmEnabled() && !result.paused && !result.refused) {
    const canAnswer = !result.stats && !result.notify?.structured && result.intent !== 'rumor' && result.retrieved?.length;
    const needTranslate = LANG !== 'zh-TW' && result.translationNote === 'showing-source';
    if (canAnswer || needTranslate) {
      const note = document.createElement('p');
      note.className = 'c-answer__llm-status'; note.setAttribute('role', 'status'); note.textContent = L('llmWorking');
      answerEl.prepend(note);
      let next = needTranslate ? await llmTranslate(result, { lang: LANG, glossary: deps.glossary }) : await llmAnswer(result, { lang: LANG });
      if (my !== runId) return;
      current = next;
      await render(next, deps);
    }
  }
}

async function render(r, deps) {
  const parts = [];
  if (pro) parts.push(`<p class="c-answer__pro-label"><span class="c-tag c-tag--pro">PRO</span> ${esc(L('proLabel'))}</p>`);
  if (r.paused) {
    parts.push(`<div class="c-banner--paused c-answer__paused" role="status"><p>${esc(L('paused'))}${r.pausedReason ? ` ${esc(L('pausedReason'))}：${esc(r.pausedReason)}` : ''}</p><p><a class="c-btn c-btn--sm" href="tel:1922">${esc(L('call1922'))}</a></p></div>`);
    parts.push(traditionalList(r.list) || `<p>${esc(L('empty'))}</p>`);
    return paint(parts, r);
  }
  for (const n of r.termNotes ?? []) parts.push(`<p class="c-answer__termnote">${esc(L('termNote', n))}</p>`);
  if (r.llmError) parts.push(`<p class="c-alert c-alert--overdue c-answer__llm-status">${esc(L('llmError', { m: r.llmError.message }))}</p>`);
  else if (r.fallback === 'extractive') parts.push(`<p class="c-alert c-alert--overdue c-answer__llm-status">${esc(L('llmFallback'))}</p>`);

  if (r.situation) parts.push(await situationCards(r.situation));
  if (r.refused) {
    if (r.verdict === 'unknown') parts.push(`<p><span class="c-verdict c-verdict--unknown">${esc(L('verdict.unknown'))}</span></p>`);
    parts.push(refusalCard(r));
    parts.push(disclosureRow(r));
    // 第二十五輪：查無／依據不足時仍給關鍵字式的「相關頁面」，使用者不會空手而回
    if (r.list?.length) parts.push(traditionalList(r.list, ['no-match', 'no-source'].includes(r.refusal?.kind) ? L('relatedListH') : L('moreH')));
    return paint(parts, r);
  }
  if (r.verdict) parts.push(verdictBlock(r));
  if (r.stats) parts.push(await statsBlock(r));
  if (r.notify) parts.push(notifyBlock(r));

  if (!r.stats && r.sentences?.length) {
    const lowRel = isLowRelevance(r);
    const tnote = r.translationNote === 'showing-source' ? L('translationSource') : r.translationNote === 'machine' ? L('translationMachine') : '';
    parts.push(`<section class="c-answer__body" aria-labelledby="ans-h">
      <h2 id="ans-h">${esc(L('answerH'))} <span class="c-answer__sub">· ${esc(lowRel ? L('lowRelevanceSub') : L('answerSub'))}</span> <span class="c-ai-badge">${esc(L('aiBadge'))}</span></h2>
      ${lowRel ? `<p class="c-answer__lowrel" role="note">${esc(L('lowRelevance'))}</p>` : ''}
      ${tnote ? `<p class="c-translation-badge">${esc(tnote)}</p>` : ''}
      ${conflictNotes(r)}
      <div${r.translationNote === 'showing-source' ? ' lang="zh-TW"' : ''}>${sentenceList(r, { pro })}</div>
      ${r.llm?.dropped?.length ? `<p class="muted">${esc(L('llmDropped', { n: r.llm.dropped.length }))}</p>` : ''}
    </section>`);
  }
  parts.push(disclosureRow(r));
  if (r.actions?.length) {
    parts.push(`<section class="c-answer__next" aria-labelledby="next-h"><h3 id="next-h">${esc(L('next'))}</h3><ul class="c-answer__actions">${r.actions.map((a) => `<li>${
      a.kind === 'copy' ? `<button type="button" class="c-btn c-btn--ghost" data-copy-text="${esc(a.value)}">${esc(a.label)}</button>`
        : a.href?.startsWith('tel:') ? `<a class="c-btn c-btn--primary" href="${esc(a.href)}">${esc(a.label)}</a>`
          : a.href ? link(a.href, a.label, 'c-btn c-btn--ghost') : `<span class="c-tag">${esc(a.label)}</span>`}</li>`).join('')}</ul></section>`);
  }
  if (!r.stats) parts.push(sourceList(r.sources, { pro }));
  const rel = [...(r.related ?? []).map((x) => x.q), ...(r.followUps ?? [])].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 3);
  if (rel.length) parts.push(`<section class="c-answer__related" aria-labelledby="rel-h"><h3 id="rel-h">${esc(L('relatedH'))}</h3><ul>${rel.map((q) => `<li><a href="${esc(askHref(q))}" data-ask="${esc(q)}">${esc(q)}</a></li>`).join('')}</ul></section>`);
  if (r.fallbackList && r.list?.length) { parts.unshift(`<p class="c-answer__lowconf">${esc(L('lowConf'))}</p>`); parts.push(traditionalList(r.list, L('moreH'))); }
  return paint(parts, r);
}

function paint(parts, r) {
  parts.push(fullTextLink(lastQ)); // 第二十八輪：每個答案最後都附「用全文搜尋找『…』」（相關頁面清單之後；查無時尤其重要）
  answerEl.innerHTML = `<div class="c-answer__inner" data-intent="${esc(r.intent)}" data-mode="${esc(r.disclosure?.mode ?? 'extractive')}">${parts.join('\n')}</div>`;
  answerEl.setAttribute('aria-busy', 'false');
  window.CDC?.subscriptions?.refresh?.();
  // 相關問題：站內直接重問（保留 URL 同步）
  answerEl.querySelectorAll('[data-ask]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    if (input) input.value = a.dataset.ask;
    form?.requestSubmit ? form.requestSubmit() : run(a.dataset.ask);
  }));
}

function askHref(q) {
  const sp = new URLSearchParams(); sp.set('q', q); if (pro) sp.set('view', 'pro');
  return `${url('/ask/')}?${sp.toString()}`;
}

// ───────── 右欄 ─────────
async function renderSide(r, deps) {
  if (!sideEl) return;
  const blocks = [];
  const d = (deps.diseases ?? []).find((x) => x.id === r.disease);
  if (d) {
    let page = null;
    if (d.hasPage || d.page) page = await v1(`diseases/${d.slug}`, null);
    const kf = page?.keyFacts ?? {};
    const pageI18n = LANG !== 'zh-TW' ? page?.i18n?.[LANG] : null;
    const facts = ['symptoms', 'transmission', 'incubation', 'prevention', 'treatment', 'notify'].filter((k) => kf[k]).map((k) => `<div><dt>${esc(L(`side.${k}`))}</dt><dd>${esc(pageI18n?.keyFacts?.[k] ?? kf[k])}</dd></div>`).join('');
    const gov = page?.governance ?? d.governance ?? {};
    blocks.push(`<section class="c-side-card c-side-card--disease"><h2>${esc(L('side.disease'))}：${esc(pageI18n?.title ?? d.name)}</h2>
      ${facts ? `<dl class="c-deflist c-deflist--sm">${facts}</dl>` : `<p class="muted">${esc(d.nameEn ?? '')}${d.legalCategory ? ` · 第 ${esc(d.legalCategory)} 類法定傳染病` : ''}</p>`}
      ${gov.reviewedAt ? `<p class="c-provenance">${esc(L('reviewed'))} ${esc(gov.reviewedAt)} · ${esc(gov.ownerName ?? '')}</p>` : ''}
      ${d.hasPage || d.page ? `<p>${link(`/diseases/${d.slug}/`, `${L('side.full')} →`)}</p>` : ''}</section>`);
    const news = page?.related?.news?.length ? page.related.news : (await v1('news', [])).filter((n) => (n.diseases ?? []).includes(d.id) && n.governance?.whitelist !== false);
    if (news?.length) blocks.push(`<section class="c-side-card"><h2>${esc(L('side.news'))}</h2><ul class="c-side-list">${news.slice(0, 3).map((n) => `<li>${link(n.path ?? `/news/${String(n.id).replace(/^news\./, '')}/`, n.title)} <span class="muted">${esc(n.publishedAt ?? n.reviewedAt ?? '')}</span></li>`).join('')}</ul></section>`);
    const ds = (deps.datasets ?? []).filter((x) => (x.diseases ?? []).includes(d.id));
    const dsAll = ds.length ? ds : (await v1('datasets', [])).filter((x) => (x.diseases ?? []).includes(d.id));
    if (dsAll.length) blocks.push(`<section class="c-side-card"><h2>${esc(L('side.data'))}</h2><ul class="c-side-list">${dsAll.slice(0, 3).map((x) => `<li>${link(x.canonicalUrl ?? x.portalUrl ?? '/data/', x.title)} <span class="muted">${esc((x.formats ?? x.format ?? ['CSV', 'JSON']).join(' / '))}</span></li>`).join('')}</ul></section>`);
  } else if (r.stats) {
    const src = r.sources?.[0];
    if (src) blocks.push(`<section class="c-side-card"><h2>${esc(L('side.data'))}</h2><ul class="c-side-list"><li>${link(src.url, src.title)}</li></ul></section>`);
  }
  if (!document.querySelector('.c-channels')) {
    blocks.push(`<section class="c-side-card"><h2>${esc(L('side.channels'))}</h2><ul class="c-side-list">${L('channels').map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>`);
  }
  sideEl.innerHTML = blocks.join('');
}

// ───────── 進階：BYOK ─────────
function setupAdvanced() {
  const adv = document.getElementById('ask-advanced');
  let keyInput = document.getElementById('llm-key');
  if (!adv) return;
  purgeLegacyKey();
  // 第二十三輪（26.4）：金鑰欄位只給已登入後台的同事；一般讀者看不到「進階」裡的金鑰區（揭露表仍顯示）
  const keyBlock = adv.querySelector('[data-llm-staff]');
  if (!staffSessionActive()) { if (keyBlock) keyBlock.remove(); setKey(''); return; }
  if (keyBlock) keyBlock.hidden = false;
  const body = adv.querySelector('.c-advanced__body') ?? adv;
  if (!keyInput) {
    body.insertAdjacentHTML('afterbegin', '<p><label for="llm-key"><b>Anthropic API key</b></label><br><input id="llm-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" class="c-input"></p>');
    keyInput = document.getElementById('llm-key');
  }
  const has = !!getKey();
  if (has) keyInput.value = '••••••••••••';
  keyInput.insertAdjacentHTML('afterend', `
    <span class="c-llm-ctl">
      <button type="button" class="c-btn c-btn--sm" data-llm="save">儲存</button>
      <button type="button" class="c-btn c-btn--sm c-btn--ghost" data-llm="clear">清除</button>
      <label>模型 <select data-llm="model">${llmModels().map((m) => `<option value="${m}"${m === getModel() ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-llm="enabled"${llmEnabled() ? ' checked' : ''}> 使用 LLM 模式</label>
    </span>
    <span class="c-llm-note muted" role="status">${has ? '已設定 key（只存在這個分頁，關閉即清除）' : '未設定：使用抽取式整理（不呼叫任何模型）'}</span>
    <small class="c-llm-privacy">同事示範用。key 只存在這個分頁的工作階段（sessionStorage <code>cdc.llmKey</code>），關閉分頁即清除；由瀏覽器直接呼叫 api.anthropic.com，不經過本站伺服器；送出前問題已遮蔽個資，只送出官方片段。用完請按「清除」。</small>`);
  const note = adv.querySelector('.c-llm-note');
  adv.addEventListener('click', (e) => {
    const b = e.target.closest('[data-llm]'); if (!b) return;
    if (b.dataset.llm === 'save') {
      const v = keyInput.value.trim();
      if (v && !v.startsWith('••')) { setKey(v); try { sessionStorage.setItem(LLM_ON_KEY, '1'); } catch { /* ignore */ } keyInput.value = '••••••••••••'; note.textContent = '已儲存。重新提問即使用 LLM 模式。'; adv.querySelector('[data-llm="enabled"]').checked = true; }
    }
    if (b.dataset.llm === 'clear') { setKey(''); keyInput.value = ''; note.textContent = '已清除 key，回到抽取式整理。'; adv.querySelector('[data-llm="enabled"]').checked = false; }
  });
  adv.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset?.llm === 'model') setModel(t.value);
    if (t.dataset?.llm === 'enabled') { try { sessionStorage.setItem(LLM_ON_KEY, t.checked ? '1' : '0'); } catch { /* ignore */ } }
  });
}
