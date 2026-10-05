// /legacy/：舊網址查詢頁（七語）。貼上舊官網的網址或路徑 → 前端 fetch v1/legacy-map.json（key 已正規化）→ 命中顯示新頁連結與該筆狀態；
// 查不到顯示站內搜尋（/ask/?q=）與 1922。頁面下方說明轉址政策（301、保留期、關閉日、showLegacyUntil）。
// 讀 ?u=（專業層從各頁的「舊網址對應」帶過來）。正規化規則與 404 共用 _partials.mjs 的 legacyKeys()（toString 嵌入）。
// 建置時另外嵌入「狀態表」（site.migration 的逐筆狀態、目標頁標題與連結），因為 legacy-map.json 只有 path 對照、沒有狀態。
// 對 V1 的 site.migration 一律容錯：沒有資料時仍可查（只靠 legacy-map），只是不顯示狀態。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { pageHead, hrefFor, L, legacyKey, LEGACY_LOOKUP_JS, LEGACY_STATUS_KIND, hasPlaceholder, diseaseName } from './_partials.mjs';

const STATUSES = ['migrated', 'merged', 'archived', 'pending', 'dropped'];
import { LEGACY_REQ_KEYS } from './_partials.mjs';
const REQS = LEGACY_REQ_KEYS;

export function pages() { return [{ path: '/legacy/', lang: '*', noindex: true, props: {} }]; }

export function meta(ctx) {
  return { title: ctx.t('legacy.title'), description: ctx.t('legacy.lead'), noindex: true, bodyClass: 'page-legacy' };
}

/** 新站區塊（疾病頁錨點）→ 介面字 key；用於「新站對應 {疾病} 的 {區塊}」提示 */
const BLOCK_KEY = {
  'what-to-do': 'hub.pub.what-to-do', symptoms: 'hub.pub.symptoms', transmission: 'hub.pub.transmission', prevention: 'hub.pub.prevention', treatment: 'hub.pub.treatment',
  vaccine: 'hub.pub.vaccine', situation: 'hub.pub.situation', faq: 'hub.pub.faq', 'pro-docs': 'hub.pro.docs', 'pro-report': 'hub.pro.report', 'pro-programs': 'hub.pro.programs',
  'pro-services': 'hub.pro.services', 'pro-stats': 'hub.pro.stats', 'pro-research': 'hub.pro.research',
};
/** 目標內容型別 → 區塊（錨點沒寫時，用 mapTo／目標型別推得：Q&A 對應 Q&A 區塊、文件對應「指引與手冊」…） */
const TYPE_BLOCK_KEY = {
  faq: 'hub.pub.faq', document: 'hub.pro.docs', labtest: 'hub.pro.report', dataset: 'hub.pro.stats', news: 'disease.news', media: 'disease.materials', publication: 'disease.materials',
  topic: 'home.topics', research: 'hub.pro.research', service: 'hub.pro.services',
};

/** 這筆舊頁在新站對應的區塊名稱（依 mapTo → 錨點 → 目標型別；都沒有回傳 null） */
export function blockLabel(ctx, it, tg) {
  const mt = it?.mapTo ?? {};
  let k = BLOCK_KEY[mt.block] ?? BLOCK_KEY[mt.anchor] ?? BLOCK_KEY[it?.anchor] ?? null;
  if (!k && mt.kind === 'disease-page') k = 'disease.onemin';
  if (!k && mt.kind === 'master-field') k = mt.field === 'incubation' ? 'kf.incubation' : 'hub.pro.report';
  if (!k && mt.kind === 'page' && /report/.test(mt.path ?? '')) k = 'hub.pro.report';
  if (!k && mt.kind === 'related') k = TYPE_BLOCK_KEY[mt.type] ?? null;
  if (!k && tg) k = TYPE_BLOCK_KEY[tg.type] ?? null;
  return k ? ctx.t(k) : null;
}

/**
 * 逐筆狀態表（key＝正規化後的舊網址）與目標頁資訊；沒有 site.migration 就是空的。
 * {id} 佔位的網址（推導清單全部都是）改以「URL 模式＋#片段」比對，並依 (模式, 片段) 合併：72 種疾病共用同一種模式，
 * 光看網址無法知道是哪一種疾病，所以每組記下 c＝涉及幾份清單；c＝1 才有確定的疾病與目標，c＞1 只提示「這是舊站疾病頁的『{oldTitle}』」並導向傳染病列表。
 */
export function lookupTables(ctx) {
  const { site } = ctx;
  const items = {};
  const groups = new Map();
  const targets = {};
  for (const list of site.migration?.lists ?? []) {
    const dId = list.disease ?? (list.scope?.kind === 'disease' ? list.scope.disease : null);
    const dm = dId ? site.diseaseMasterById?.get(dId) : null;
    for (const it of list.items ?? []) {
      if (!it?.oldUrl) continue;
      const tg = (it.toId ?? it.target) ? site.byId.get(it.toId ?? it.target) : null; // toId：目標為失效版文件時直接指向現行版
      if (tg && !targets[tg.id]) targets[tg.id] = { title: L(ctx, tg, 'title') ?? tg.title, href: hrefFor(ctx, tg) };
      // newPath：去處是系統產生頁／功能頁（例：/travel/JP/），不是內容 id ⇒ 以 path:{newPath} 當 targets 的 key，標題顯示路徑
      const np = !tg && it.newPath ? `path:${it.newPath}` : null;
      if (np && !targets[np]) targets[np] = { title: it.newPath, href: `${config.basePath}${it.newPath}` };
      const info = {
        t: it.oldTitle ?? '', p: it.oldPath ?? '', s: it.status ?? 'pending', v: it.verified !== false,
        g: tg ? tg.id : np, a: it.anchor ?? '', n: it.note ?? '', r: it.newRequirements ?? [],
      };
      if (hasPlaceholder(it.oldUrl)) {
        const [noHash, hash = ''] = String(it.oldUrl).split('#');
        const k = legacyKey(noHash.replace(/\{[^}]*\}/g, 'zzidzz'));
        if (!k) continue;
        const re = `^${k.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&').replace(/zzidzz/g, '[^/?]+')}$`;
        const gk = `${re}|${hash.toLowerCase()}`;
        let g = groups.get(gk);
        if (!g) { g = { re, h: hash.toLowerCase(), ...info, lists: new Map(), blocks: new Map() }; groups.set(gk, g); }
        const lid = list.id ?? `${groups.size}:${g.lists.size}`;
        if (!g.lists.has(lid)) g.lists.set(lid, { g: info.g, a: info.a, dn: dm ? diseaseName(ctx, dm) : null });
        const b = blockLabel(ctx, it, tg);
        if (b) g.blocks.set(b, (g.blocks.get(b) ?? 0) + 1);
        continue;
      }
      const key = legacyKey(it.oldUrl);
      if (!key || items[key]) continue;
      items[key] = info;
    }
  }
  const pats = [...groups.values()].map(({ lists, blocks, ...g }) => {
    const only = lists.size === 1 ? [...lists.values()][0] : null;
    const b = [...blocks.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    return { ...g, c: lists.size, b, ...(only ? { g: only.g, a: only.a, dn: only.dn } : { g: null, a: '' }) };
  });
  return { items, pats, targets };
}

const statsOf = (list) => {
  const c = { total: 0, migrated: 0, merged: 0, archived: 0, pending: 0, dropped: 0 };
  for (const it of list.items ?? []) { c.total++; if (c[it.status] != null) c[it.status]++; }
  return c;
};

export function render(ctx) {
  const { site, t, url } = ctx;
  const lists = site.migration?.lists ?? [];
  const until = lists.map((l) => l.showLegacyUntil).filter(Boolean).sort().pop() ?? null;
  const { items, pats, targets } = lookupTables(ctx);
  // 第六輪：每種傳染病一份的推導清單（70 份上下）合併成一列，只逐列列出人工清單
  const derivedLists = lists.filter((l) => l.derived === true);
  const derivedTotal = derivedLists.reduce((a, l) => { const c = statsOf(l); for (const k of Object.keys(a)) a[k] += c[k]; return a; }, { total: 0, migrated: 0, merged: 0, archived: 0, pending: 0, dropped: 0 });
  const S = {
    hitT: t('legacy.hit.t'), hitGo: t('legacy.hit.go'), hitStatus: t('legacy.hit.status'), hitOld: t('legacy.hit.old'), hitNote: t('legacy.hit.note'), hitPattern: t('legacy.hit.pattern'), hitNopage: t('legacy.hit.nopage'),
    missT: t('legacy.miss.t'), missD: t('legacy.miss.d'), missSearch: t('legacy.miss.search', { q: '{q}' }), missCall: t('legacy.miss.call'),
    unverified: t('legacy.unverified'), hintT: t('legacy.hint.t'), hintOne: t('legacy.hint.one', { title: '{title}', disease: '{disease}', block: '{block}' }), hintMany: t('legacy.hint.many', { title: '{title}', block: '{block}' }), hintGo: t('legacy.hint.go', { disease: '{disease}', block: '{block}' }), hintList: t('legacy.hint.list'), hintBlock: t('legacy.hint.block'), reqT: t('legacy.req.t'), err: t('legacy.err'), loading: t('legacy.loading'), home: t('404.home'),
    status: Object.fromEntries(STATUSES.map((k) => [k, t(`legacy.status.${k}`)])), kind: LEGACY_STATUS_KIND,
    req: Object.fromEntries(REQS.map((k) => [k, t(`legacy.req.${k}`)])),
  };
  const data = {
    base: config.basePath, map: url('/v1/legacy-map.json', { noLang: true }), ask: url('/ask/'), home: url('/'), diseases: url('/diseases/'),
    items, pats, targets, s: S,
  };
  return html`${pageHead(ctx, { trail: [{ label: t('legacy.title') }], h1: t('legacy.title'), lead: t('legacy.lead') })}
<form class="c-legacyform" data-lg-form role="search" action="${url('/legacy/')}" method="get">
  <label class="sr-only" for="lg-u">${t('legacy.label')}</label>
  <input id="lg-u" name="u" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${t('legacy.ph')}">
  <button type="submit" class="c-btn">${t('legacy.go')}</button>
</form>
<div class="c-legacyres" id="lg-res" aria-live="polite"><noscript><p class="muted">${t('legacy.nojs')}</p></noscript></div>

${lists.length ? html`<section class="c-block" aria-labelledby="lg-cov"><h2 id="lg-cov">${t('legacy.cov.t')}</h2>
  <ul class="c-legacycov">${lists.filter((l) => l.derived !== true).map((l) => { const c = statsOf(l); return html`<li><strong>${L(ctx, l, 'title') ?? l.title}</strong><br><span class="muted">${t('legacy.cov.row', c)}</span></li>`; })}
    ${derivedLists.length ? html`<li><strong>${t('legacy.cov.derived', { n: derivedLists.length })}</strong><br><span class="muted">${t('legacy.cov.row', derivedTotal)}</span></li>` : ''}</ul>
</section>` : ''}

<section class="c-block" aria-labelledby="lg-policy"><h2 id="lg-policy">${t('legacy.policy.t')}</h2>
  <ul class="c-legacypolicy">
    <li>${t('legacy.policy.301')}</li>
    <li>${t('legacy.policy.410')}</li>
    ${until ? html`<li>${t('legacy.policy.until', { date: ctx.fmtDate(until) })}</li>` : ''}
    <li>${t('legacy.policy.close')}</li>
    <li>${t('legacy.policy.machine')}：<a href="${url('/v1/legacy-map.json', { noLang: true })}"><code>/v1/legacy-map.json</code></a> · <a href="${url('/v1/redirects.json', { noLang: true })}"><code>/v1/redirects.json</code></a></li>
  </ul>
</section>
<script type="application/json" id="lg-data">${raw(jsonScript(data))}</script>
<script>${raw(LEGACY_LOOKUP_JS)}
${raw(CLIENT)}</script>`;
}

// client：只用 textContent／href；目標路徑必須是站內絕對路徑（/ 開頭、不是 //）
const CLIENT = `(function(){
  var el=document.getElementById('lg-data'); if(!el) return;
  var D; try{D=JSON.parse(el.textContent)}catch(e){return}
  var S=D.s, $=function(s){return document.querySelector(s)};
  var form=$('[data-lg-form]'), input=$('#lg-u'), res=$('#lg-res');
  var idx=null, mapErr=false, loading=null;
  var itemIdx=legacyIndex(D.items);
  function mk(tag,cls,txt){var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e}
  function safe(p){return typeof p==='string' && p.charAt(0)==='/' && p.charAt(1)!=='/'}
  function loadMap(){
    if(loading) return loading;
    loading=fetch(D.map).then(function(r){return r.ok?r.json():null}).then(function(j){
      var m=j&&(j.data&&typeof j.data==='object'&&!Array.isArray(j.data)?j.data:j);
      if(!m||typeof m!=='object') throw new Error('bad'); idx=legacyIndex(m);
    }).catch(function(){mapErr=true});
    return loading;
  }
  function row(dl,k,v){ if(v==null||v==='') return; var dt=mk('dt',null,k), dd=mk('dd'); if(typeof v==='string') dd.textContent=v; else dd.appendChild(v); dl.appendChild(dt); dl.appendChild(dd); }
  function pill(st){ return mk('span','c-pill c-pill--'+(S.kind[st]||'neutral'),S.status[st]||st); }
  function missLinks(card,q){
    var ul=mk('ul','c-linklist');
    if(q){ var li=mk('li'), a=mk('a',null,S.missSearch.replace('{q}',q)); a.href=D.ask+'?q='+encodeURIComponent(q); li.appendChild(a); ul.appendChild(li); }
    var l2=mk('li'), a2=mk('a',null,S.missCall); a2.href='tel:1922'; l2.appendChild(a2); ul.appendChild(l2);
    var l3=mk('li'), a3=mk('a',null,S.home); a3.href=D.home; l3.appendChild(a3); ul.appendChild(l3);
    card.appendChild(ul);
  }
  function patFind(val){
    var k=legacyKeys(val)[0]; if(!k||!D.pats) return null;
    var k0=k.split('?')[0], h=''; var i=String(val).indexOf('#'); if(i>=0){ h=String(val).slice(i+1); try{h=decodeURIComponent(h);}catch(e){} h=h.toLowerCase(); }
    var hits=D.pats.filter(function(p){ try{ return (new RegExp(p.re).test(k)||new RegExp(p.re).test(k0)); }catch(e){ return false; } });
    if(!hits.length) return null;
    var exact=hits.filter(function(p){return p.h===h});
    return exact[0]||(!h?hits.filter(function(p){return !p.h})[0]:null)||null;
  }
  function hint(it){
    var many=it.c>1, tg=(!many&&it.g&&D.targets[it.g])?D.targets[it.g]:null, blk=it.b||S.hintBlock;
    var card=mk('section','c-legacycard c-legacycard--hint'); card.appendChild(mk('h2',null,S.hintT));
    card.appendChild(mk('p','c-legacycard__hint',(many?S.hintMany:S.hintOne).replace('{title}',it.t).replace('{block}',blk).replace('{disease}',it.dn||(tg?tg.title:''))));
    if(tg){ var a=mk('a','c-btn c-legacycard__go',S.hintGo.replace('{disease}',it.dn||tg.title).replace('{block}',blk)); a.href=tg.href+(it.a?'#'+encodeURIComponent(it.a):''); card.appendChild(a); }
    else if(many){ var a2=mk('a','c-btn c-legacycard__go',S.hintList); a2.href=D.diseases; card.appendChild(a2); }
    return card;
  }
  function show(val){
    res.textContent='';
    if(!val){ return; }
    var itf=legacyFind(itemIdx,val), it=itf&&itf.to, mf=idx?legacyFind(idx,val):null, viaPat=false;
    if(!it&&!mf){ it=patFind(val); viaPat=!!it; }
    if(viaPat&&it){ var hc=hint(it); missLinks(hc,legacyWord(val)); res.appendChild(hc); return; }
    var href=null, title=null;
    if(it&&it.g&&D.targets[it.g]){ var tg=D.targets[it.g]; href=tg.href+(it.a?'#'+encodeURIComponent(it.a):''); title=tg.title; }
    else if(mf&&safe(mf.to)){ href=D.base+mf.to; title=mf.to; }
    var card;
    if(href){
      card=mk('section','c-legacycard'); card.appendChild(mk('h2',null,S.hitT));
      var a=mk('a','c-btn c-legacycard__go',S.hitGo+'：'+title); a.href=href; card.appendChild(a);
    } else if(it){
      card=mk('section','c-legacycard c-legacycard--miss'); card.appendChild(mk('h2',null,S.hitNopage));
    } else if(mapErr&&!idx){
      card=mk('section','c-legacycard c-legacycard--miss'); card.appendChild(mk('h2',null,S.err)); missLinks(card,''); res.appendChild(card); return;
    } else {
      card=mk('section','c-legacycard c-legacycard--miss'); card.appendChild(mk('h2',null,S.missT)); card.appendChild(mk('p',null,S.missD)); missLinks(card,legacyWord(val)); res.appendChild(card); return;
    }
    if(it){
      var dl=mk('dl'); row(dl,S.hitOld,it.t+(it.p?'（'+it.p+'）':'')); var st=mk('span'); st.appendChild(pill(it.s)); if(!it.v) st.appendChild(mk('span','muted',' '+S.unverified)); row(dl,S.hitStatus,st);
      row(dl,S.hitNote,it.n||null);
      if(viaPat) row(dl,'',S.hitPattern);
      if(it.r&&it.r.length){ var rs=mk('span'); it.r.forEach(function(k){ var c=mk('span','c-chip c-chip--req',S.req[k]||k); rs.appendChild(c); rs.appendChild(document.createTextNode(' ')); }); row(dl,S.reqT,rs); }
      card.appendChild(dl);
    }
    if(!href) missLinks(card,legacyWord(val));
    res.appendChild(card);
  }
  function run(val){ val=(val||'').trim(); if(!val){ res.textContent=''; return; } res.textContent=S.loading; loadMap().then(function(){show(val)}); }
  form.addEventListener('submit',function(e){
    e.preventDefault(); var v=input.value.trim();
    try{ var u=new URL(location.href); if(v) u.searchParams.set('u',v); else u.searchParams.delete('u'); history.replaceState(null,'',u.pathname+u.search); }catch(x){}
    run(v);
  });
  var q0=''; try{ q0=new URLSearchParams(location.search).get('u')||''; }catch(x){}
  if(q0){ input.value=q0; run(q0); }
})();`;
